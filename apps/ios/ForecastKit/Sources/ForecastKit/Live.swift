import Foundation

// Turns Supabase rows into the engine's Snapshot, ported from apps/web/src/lib/live.ts.
// Keep the two in step. Pure, so it is easy to test: the caller passes "today" as a
// YYYY-MM-DD string in the person's own timezone. Rows decode with .convertFromSnakeCase.

public enum Live {
    public struct Account: Codable, Sendable, Hashable {
        public var id: String
        public var type: String
        public var subtype: String?
        public var currentBalance: Double?
        public var availableBalance: Double?
        public var includeInCash: Bool

        public init(id: String, type: String, subtype: String? = nil, currentBalance: Double?, availableBalance: Double?, includeInCash: Bool) {
            self.id = id; self.type = type; self.subtype = subtype
            self.currentBalance = currentBalance; self.availableBalance = availableBalance; self.includeInCash = includeInCash
        }
    }

    public struct Transaction: Codable, Sendable, Hashable {
        public var accountId: String?
        public var amount: Double
        public var date: String
        public var name: String
        public var merchantName: String?
        public var categoryPrimary: String?
        public var pending: Bool

        public init(accountId: String?, amount: Double, date: String, name: String, merchantName: String? = nil,
                    categoryPrimary: String? = nil, pending: Bool = false) {
            self.accountId = accountId; self.amount = amount; self.date = date; self.name = name
            self.merchantName = merchantName; self.categoryPrimary = categoryPrimary; self.pending = pending
        }
    }

    public struct Stream: Codable, Sendable, Hashable, Identifiable {
        public enum Direction: String, Codable, Sendable { case inflow, outflow }

        public var id: String
        public var direction: Direction
        public var description: String
        public var merchantName: String?
        public var userName: String?
        public var frequency: String
        public var averageAmount: Double?
        public var lastAmount: Double?
        public var lastDate: String?
        public var predictedNextDate: String?
        public var isActive: Bool
        public var ignored: Bool
        public var categoryPrimary: String?

        public init(id: String, direction: Direction, description: String, merchantName: String? = nil, userName: String? = nil,
                    frequency: String, averageAmount: Double? = nil, lastAmount: Double? = nil, lastDate: String? = nil,
                    predictedNextDate: String? = nil, isActive: Bool = true, ignored: Bool = false, categoryPrimary: String? = nil) {
            self.id = id; self.direction = direction; self.description = description; self.merchantName = merchantName
            self.userName = userName; self.frequency = frequency; self.averageAmount = averageAmount; self.lastAmount = lastAmount
            self.lastDate = lastDate; self.predictedNextDate = predictedNextDate; self.isActive = isActive
            self.ignored = ignored; self.categoryPrimary = categoryPrimary
        }

        var label: String { userName ?? merchantName ?? description }
        var amount: Double { lastAmount ?? averageAmount ?? 0 }
    }

    public struct BucketRow: Codable, Sendable, Hashable {
        public var name: String
        public var goal: Double
        public var saved: Double
        public var perPaycheck: Double
        public var archivedAt: String?

        public init(name: String, goal: Double, saved: Double, perPaycheck: Double, archivedAt: String? = nil) {
            self.name = name; self.goal = goal; self.saved = saved; self.perPaycheck = perPaycheck; self.archivedAt = archivedAt
        }
    }

    public struct Settings: Codable, Sendable, Hashable {
        public var cushion: Double
        public var payAmountOverride: Double?
        public var nextPaydayOverride: String?
        public var payEveryDaysOverride: Int?

        public init(cushion: Double = 150, payAmountOverride: Double? = nil, nextPaydayOverride: String? = nil, payEveryDaysOverride: Int? = nil) {
            self.cushion = cushion; self.payAmountOverride = payAmountOverride
            self.nextPaydayOverride = nextPaydayOverride; self.payEveryDaysOverride = payEveryDaysOverride
        }
    }

    public struct Rows: Sendable, Hashable {
        public var accounts: [Account]
        public var transactions: [Transaction]
        public var streams: [Stream]
        public var buckets: [BucketRow]
        public var settings: Settings?

        public init(accounts: [Account] = [], transactions: [Transaction] = [], streams: [Stream] = [],
                    buckets: [BucketRow] = [], settings: Settings? = nil) {
            self.accounts = accounts; self.transactions = transactions; self.streams = streams
            self.buckets = buckets; self.settings = settings
        }
    }

    public struct FoundPaycheck: Sendable, Hashable {
        public var amount: Double
        public var nextIn: Int
        public var every: Int
        public var name: String
        public var streamId: String?
    }

    public struct FoundBill: Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var amount: Double
        public var dueIn: Int
        public var every: Int
    }

    public static let every: [String: Int] = ["WEEKLY": 7, "BIWEEKLY": 14, "SEMI_MONTHLY": 15, "MONTHLY": 30, "ANNUALLY": 365]

    /// Money that moves between your own accounts, or pays off a card, isn't day-to-day spending.
    static let notSpending: Set<String> = ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "INCOME", "BANK_FEES"]

    // MARK: Dates

    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private static func day(_ ymd: String) -> Date {
        let p = ymd.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return .distantPast }
        return utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))!
    }

    public static func daysBetween(_ from: String, _ to: String) -> Int {
        Int((day(to).timeIntervalSince(day(from)) / 86_400).rounded())
    }

    /// Today's date as YYYY-MM-DD in a timezone.
    public static func localYmd(_ timeZone: TimeZone = .current, now: Date = .now) -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        let d = c.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", d.year!, d.month!, d.day!)
    }

    /// YYYY-MM-DD a number of days after a YYYY-MM-DD date.
    public static func ymd(_ from: String, plus days: Int) -> String {
        localYmd(TimeZone(identifier: "UTC")!, now: day(from).addingTimeInterval(Double(days) * 86_400))
    }

    /// Days from today until a stream's next date, rolled forward past anything already gone.
    private static func nextIn(_ s: Stream, frequency: String? = nil, today: String, min: Int) -> Int? {
        guard let every = every[frequency ?? s.frequency], let anchor = s.predictedNextDate ?? s.lastDate else { return nil }
        var d = daysBetween(today, anchor)
        if s.predictedNextDate == nil { d += every }
        while d < min { d += every }
        return d
    }

    // MARK: Finding things

    /// The paycheck: the biggest regular deposit, unless the person set it by hand.
    public static func findPaycheck(streams: [Stream], settings: Settings?, today: String) -> FoundPaycheck? {
        let inflows = streams
            .filter { $0.direction == .inflow && $0.isActive && !$0.ignored && (every[$0.frequency] ?? .max) <= 30 }
            .sorted { $0.amount / Double(every[$0.frequency]!) > $1.amount / Double(every[$1.frequency]!) }
        let best = inflows.first
        let o = settings

        guard let cadence = o?.payEveryDaysOverride ?? best.flatMap({ every[$0.frequency] }),
              let amount = o?.payAmountOverride ?? best?.amount, amount > 0 else { return nil }

        var due: Int?
        if let next = o?.nextPaydayOverride {
            var d = daysBetween(today, next)
            while d < 1 { d += cadence }
            due = d
        } else if let best {
            let frequency = every.first { $0.value == cadence }?.key ?? best.frequency
            due = nextIn(best, frequency: frequency, today: today, min: 1)
        }
        guard let due else { return nil }
        return FoundPaycheck(amount: amount, nextIn: due, every: cadence, name: best?.label ?? "Paycheck", streamId: best?.id)
    }

    /// Bills: regular outflows the person hasn't turned off.
    public static func findBills(_ streams: [Stream], today: String) -> [FoundBill] {
        streams.compactMap { s -> FoundBill? in
            guard s.direction == .outflow, s.isActive, !s.ignored, s.categoryPrimary != "TRANSFER_OUT",
                  let every = every[s.frequency], let dueIn = nextIn(s, today: today, min: 0) else { return nil }
            return FoundBill(id: s.id, name: s.label, amount: s.amount, dueIn: dueIn, every: every)
        }
        .enumerated()
        .sorted { ($0.element.dueIn, $0.offset) < ($1.element.dueIn, $1.offset) }
        .map(\.element)
    }

    /// Day-to-day spending: outflows that aren't transfers, card payments or known bills.
    private static func isSpending(_ t: Transaction, billNames: Set<String>) -> Bool {
        if t.amount <= 0 { return false }
        if let c = t.categoryPrimary, notSpending.contains(c) { return false }
        return !billNames.contains((t.merchantName ?? t.name).lowercased())
    }

    public static func snapshot(_ rows: Rows, today: String) -> Snapshot? {
        guard let paycheck = findPaycheck(streams: rows.streams, settings: rows.settings, today: today) else { return nil }

        let cashAccounts = rows.accounts.filter(\.includeInCash)
        let cash = cashAccounts.reduce(0) { $0 + ($1.availableBalance ?? $1.currentBalance ?? 0) }

        let bills = findBills(rows.streams, today: today)
        let billNames = Set(rows.streams.filter { $0.direction == .outflow }
            .flatMap { [$0.description, $0.merchantName].compactMap { $0?.lowercased() } })

        let spendingAccounts = Set(rows.accounts.filter { $0.includeInCash || $0.type == "credit" }.map(\.id))
        let spending = rows.transactions.filter {
            ($0.accountId == nil || spendingAccounts.contains($0.accountId!)) && isSpending($0, billNames: billNames)
        }

        // Cash balances already reflect today's card-less spending; only count today's debits
        // from cash accounts so "spent today" isn't subtracted twice.
        let cashIds = Set(cashAccounts.map(\.id))
        let spentToday = spending.filter { $0.date == today && $0.accountId.map(cashIds.contains) == true }.reduce(0) { $0 + $1.amount }

        func average(_ days: Int) -> Double {
            let inWindow = spending.filter {
                let d = daysBetween(today, $0.date)
                return d < 0 && d >= -days
            }
            guard let oldest = inWindow.map({ daysBetween(today, $0.date) }).min() else { return 0 }
            let span = max(1, min(days, -oldest))
            return inWindow.reduce(0) { $0 + $1.amount } / Double(span)
        }

        let buckets = rows.buckets.filter { $0.archivedAt == nil }
            .map { Bucket(name: $0.name, saved: $0.saved, goal: $0.goal, perPaycheck: $0.perPaycheck) }

        return Snapshot(cash: cash, spentToday: spentToday,
                        paycheck: Paycheck(amount: paycheck.amount, nextIn: paycheck.nextIn, every: paycheck.every),
                        bills: bills.map { Bill(name: $0.name, amount: $0.amount, dueIn: $0.dueIn, every: $0.every) },
                        buckets: buckets, cushion: rows.settings?.cushion ?? 150,
                        typicalDay: average(90).rounded(), recentPace: average(7).rounded())
    }
}
