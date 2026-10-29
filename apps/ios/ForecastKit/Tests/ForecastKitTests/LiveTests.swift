// The same cases as apps/web/src/lib/live.test.ts.
import Foundation
import Testing
@testable import ForecastKit

private let today_ = "2026-10-28"

private func stream(_ description: String = "Thing", direction: Live.Stream.Direction = .outflow, frequency: String = "MONTHLY",
                    lastAmount: Double = 50, predictedNextDate: String? = nil, ignored: Bool = false, category: String? = nil) -> Live.Stream {
    Live.Stream(id: description, direction: direction, description: description, frequency: frequency, averageAmount: 50,
                lastAmount: lastAmount, predictedNextDate: predictedNextDate, ignored: ignored, categoryPrimary: category)
}

private func rows(streams: [Live.Stream]? = nil, settings: Live.Settings? = Live.Settings(), transactions: [Live.Transaction] = []) -> Live.Rows {
    Live.Rows(
        accounts: [
            Live.Account(id: "chk", type: "depository", subtype: "checking", currentBalance: 2100, availableBalance: 2000, includeInCash: true),
            Live.Account(id: "sav", type: "depository", subtype: "savings", currentBalance: 9000, availableBalance: 9000, includeInCash: false),
            Live.Account(id: "cc", type: "credit", subtype: "credit card", currentBalance: 300, availableBalance: nil, includeInCash: false),
        ],
        transactions: transactions,
        streams: streams ?? [
            stream("ACME PAYROLL", direction: .inflow, frequency: "BIWEEKLY", lastAmount: 2200, predictedNextDate: "2026-11-06"),
            stream("INTEREST", direction: .inflow, lastAmount: 4, predictedNextDate: "2026-11-01"),
            stream("Rent", lastAmount: 1200, predictedNextDate: "2026-11-01"),
            stream("Spotify", lastAmount: 11.99, predictedNextDate: "2026-11-20"),
        ],
        buckets: [Live.BucketRow(name: "Trip", goal: 1000, saved: 100, perPaycheck: 50)],
        settings: settings)
}

@Suite struct LiveTests {
    @Test func countsWholeDaysAcrossADSTChange() {
        #expect(Live.daysBetween("2026-10-28", "2026-11-06") == 9)
        #expect(Live.daysBetween("2026-11-06", "2026-10-28") == -9)
        #expect(Live.ymd("2026-10-28", plus: 9) == "2026-11-06")
    }

    @Test func picksTheBiggestRegularDepositNotInterest() throws {
        let p = try #require(Live.findPaycheck(streams: rows().streams, settings: rows().settings, today: today_))
        #expect(p.amount == 2200 && p.nextIn == 9 && p.every == 14 && p.name == "ACME PAYROLL")
    }

    @Test func rollsAStalePredictionForward() {
        let s = [stream(direction: .inflow, frequency: "BIWEEKLY", lastAmount: 2000, predictedNextDate: "2026-10-20")]
        #expect(Live.findPaycheck(streams: s, settings: nil, today: today_)?.nextIn == 6)
    }

    @Test func letsThePersonsSettingsWin() throws {
        let o = Live.Settings(cushion: 150, payAmountOverride: 1800, nextPaydayOverride: "2026-10-31", payEveryDaysOverride: 7)
        let p = try #require(Live.findPaycheck(streams: rows().streams, settings: o, today: today_))
        #expect(p.amount == 1800 && p.nextIn == 3 && p.every == 7)
    }

    @Test func noPaycheckWhenNothingLooksLikeOne() {
        #expect(Live.findPaycheck(streams: [], settings: Live.Settings(), today: today_) == nil)
    }

    @Test func skipsIgnoredBillsAndTransfersSortedByDueDate() {
        let bills = Live.findBills(rows().streams + [
            stream("Gym", predictedNextDate: "2026-10-30", ignored: true),
            stream("To savings", predictedNextDate: "2026-10-29", category: "TRANSFER_OUT"),
        ], today: today_)
        #expect(bills.map(\.name) == ["Rent", "Spotify"])
        #expect(bills.map(\.dueIn) == [4, 23])
    }

    @Test func buildsTheEngineInputFromRows() throws {
        let r = rows(transactions: [
            Live.Transaction(accountId: "chk", amount: 12, date: today_, name: "Coffee", merchantName: "Blue Bottle", categoryPrimary: "FOOD_AND_DRINK", pending: true),
            Live.Transaction(accountId: "chk", amount: 60, date: "2026-10-27", name: "Groceries", categoryPrimary: "GENERAL_MERCHANDISE"),
            Live.Transaction(accountId: "cc", amount: 40, date: "2026-10-26", name: "Dinner", categoryPrimary: "FOOD_AND_DRINK"),
            Live.Transaction(accountId: "chk", amount: 1200, date: "2026-10-01", name: "Rent", categoryPrimary: "RENT_AND_UTILITIES"),
            Live.Transaction(accountId: "chk", amount: 500, date: "2026-10-25", name: "Transfer", categoryPrimary: "TRANSFER_OUT"),
            Live.Transaction(accountId: "chk", amount: -2200, date: "2026-10-23", name: "ACME PAYROLL", categoryPrimary: "INCOME"),
        ])
        let s = try #require(Live.snapshot(r, today: today_))
        #expect(s.cash == 2000)
        #expect(s.spentToday == 12)
        #expect(s.paycheck == Paycheck(amount: 2200, nextIn: 9, every: 14))
        #expect(s.bills.map(\.name) == ["Rent", "Spotify"])
        #expect(s.buckets == [Bucket(name: "Trip", saved: 100, goal: 1000, perPaycheck: 50)])
        // 60 + 40 over the 2 days back to the oldest purchase; rent and the transfer don't count.
        #expect(s.typicalDay == 50)
        #expect(today(s).safeToSpend > 0)
    }

    @Test func isNilUntilAPaycheckIsKnown() {
        #expect(Live.snapshot(rows(streams: []), today: today_) == nil)
    }

    @Test func decodesSupabaseRows() throws {
        let json = """
        [{"id":"s1","direction":"outflow","description":"NETFLIX","merchant_name":"Netflix","user_name":null,"frequency":"MONTHLY",
          "average_amount":15.49,"last_amount":15.49,"last_date":"2026-10-12","predicted_next_date":null,"is_active":true,
          "ignored":false,"category_primary":"ENTERTAINMENT"}]
        """
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        let s = try d.decode([Live.Stream].self, from: Data(json.utf8))
        #expect(s[0].merchantName == "Netflix" && s[0].lastDate == "2026-10-12" && s[0].isActive)
        #expect(Live.findBills(s, today: today_).first?.dueIn == 14)
    }
}
