import Foundation
import Supabase
import ForecastKit

// Supabase for sign-in and data, the same project as apps/web/src/lib/supabase.ts.
// The URL and publishable key are public by design (row level security guards the data).
enum Backend {
    static let url = URL(string: "https://baylrzvbstukjsyfnlga.supabase.co")!
    static let key = "sb_publishable_0CwEF_30F5Rtb2VHgi3ldQ_9mTVbqrd"

    /// Where the sign-in email's link comes back to. Registered in Forecast-Info.plist, and it
    /// has to be in the Supabase project's redirect URLs.
    static let redirect = URL(string: "com.connortp.forecast://login")!

    /// Sandbox gets a "use a test bank" shortcut that skips Plaid Link. Set in Forecast-Info.plist.
    static let plaidSandbox = (Bundle.main.object(forInfoDictionaryKey: "ForecastPlaidEnv") as? String ?? "sandbox") == "sandbox"

    static let client = SupabaseClient(
        supabaseURL: url, supabaseKey: key,
        options: .init(auth: .init(redirectToURL: redirect, emitLocalSessionAsInitialSession: true)))

    static var userId: UUID? { client.auth.currentUser?.id }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    /// Calls an edge function and throws its error message, so screens can show it.
    static func call<T: Decodable>(_ name: String, _ body: [String: AnyJSON] = [:]) async throws -> T {
        do {
            return try await client.functions.invoke(name, options: .init(body: body), decoder: decoder)
        } catch FunctionsError.httpError(_, let data) {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw Problem(message ?? "Something went wrong. Try again.")
        }
    }

    private static func rows<T: Decodable>(_ query: PostgrestTransformBuilder) async throws -> [T] {
        try decoder.decode([T].self, from: try await query.execute().data)
    }

    struct Loaded: Sendable, Hashable {
        var rows: Live.Rows
        var hasBank: Bool
        var onboarded: Bool

        // Screens format dates with the device clock, so "today" follows the device too.
        var today: String { Live.localYmd() }
        var snapshot: Snapshot? { Live.snapshot(rows, today: today) }
    }

    private struct Profile: Decodable { var onboardedAt: String? }

    static func load() async throws -> Loaded {
        let db = client
        let since = Live.ymd(Live.localYmd(), plus: -100)
        async let items = db.from("plaid_items").select("id", head: true, count: .exact).execute()
        async let accounts: [Live.Account] = rows(db.from("accounts")
            .select("id, type, subtype, include_in_cash, current_balance, available_balance").limit(500))
        async let transactions: [Live.Transaction] = rows(db.from("transactions")
            .select("account_id, amount, date, name, merchant_name, category_primary, pending").gte("date", value: since).limit(5000))
        async let streams: [Live.Stream] = rows(db.from("recurring_streams")
            .select("id, direction, description, merchant_name, user_name, frequency, average_amount, last_amount, last_date, predicted_next_date, is_active, ignored, category_primary").limit(500))
        async let buckets: [Live.BucketRow] = rows(db.from("buckets")
            .select("name, goal, saved, per_paycheck, archived_at").order("sort"))
        async let settings: [Live.Settings] = rows(db.from("settings")
            .select("cushion, pay_amount_override, next_payday_override, pay_every_days_override").limit(1))
        async let profile: [Profile] = rows(db.from("profiles").select("onboarded_at").limit(1))

        let r = Live.Rows(accounts: try await accounts, transactions: try await transactions, streams: try await streams,
                          buckets: try await buckets, settings: try await settings.first)
        return Loaded(rows: r, hasBank: ((try await items).count ?? 0) > 0,
                      onboarded: (try await profile).first?.onboardedAt != nil)
    }

    /// Pulls the latest from every linked bank, then reloads.
    static func refresh() async throws -> Loaded {
        let _: AnyJSON = try await call("sync-transactions")
        return try await load()
    }

    // MARK: Writes from sign-up

    /// The settings sign-up confirms. Nil clears an override, so it is sent as null.
    struct SettingsUpdate: Encodable {
        var cushion: Double
        var payAmountOverride: Double?
        var nextPaydayOverride: String?
        var payEveryDaysOverride: Int?
        var timezone = TimeZone.current.identifier

        enum CodingKeys: String, CodingKey {
            case cushion, timezone
            case payAmountOverride = "pay_amount_override", nextPaydayOverride = "next_payday_override"
            case payEveryDaysOverride = "pay_every_days_override"
        }

        func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(cushion, forKey: .cushion)
            try c.encode(timezone, forKey: .timezone)
            try c.encode(payAmountOverride, forKey: .payAmountOverride)
            try c.encode(nextPaydayOverride, forKey: .nextPaydayOverride)
            try c.encode(payEveryDaysOverride, forKey: .payEveryDaysOverride)
        }
    }

    private struct NewBucket: Encodable {
        var user_id: UUID
        var name: String
        var goal: Double
        var per_paycheck: Double
        var sort: Int
    }

    static func saveSignup(settings: SettingsUpdate, streams: [Live.Stream], billsOff: Set<String>, buckets: [ForecastKit.Bucket]) async throws {
        guard let uid = userId else { throw Problem("You're signed out. Sign in again.") }
        let db = client
        try await db.from("settings").update(settings, returning: .minimal).eq("user_id", value: uid.uuidString).execute()
        try await withThrowingTaskGroup(of: Void.self) { group in
            for s in streams where s.direction == .outflow {
                group.addTask {
                    try await db.from("recurring_streams").update(["ignored": billsOff.contains(s.id)], returning: .minimal)
                        .eq("id", value: s.id).execute()
                }
            }
            try await group.waitForAll()
        }
        // Only the first time through: going back and forth shouldn't add buckets twice.
        let existing = try await db.from("buckets").select("id", head: true, count: .exact).execute().count ?? 0
        let keep = buckets.filter { $0.perPaycheck > 0 }
        if existing == 0, !keep.isEmpty {
            let new = keep.enumerated().map { NewBucket(user_id: uid, name: $1.name, goal: $1.goal, per_paycheck: $1.perPaycheck, sort: $0) }
            try await db.from("buckets").insert(new, returning: .minimal).execute()
        }
    }

    static func finishSignup() async throws {
        guard let uid = userId else { throw Problem("You're signed out. Sign in again.") }
        try await client.from("profiles").update(["onboarded_at": Date.now.ISO8601Format()], returning: .minimal)
            .eq("id", value: uid.uuidString).execute()
    }
}

/// An error with a sentence a person can read.
struct Problem: LocalizedError {
    var message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
