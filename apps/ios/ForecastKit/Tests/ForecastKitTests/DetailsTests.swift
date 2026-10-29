// The same cases as apps/web/src/lib/details.test.ts.
import Testing
@testable import ForecastKit

@Suite struct DetailsTests {
    @Test func cyclePlacesTodayAndBillsBetweenPaychecks() {
        let s = Scenario.partly.snapshot // pay in 6 of 14 days, bills on days 2, 4, 5
        let c = cycle(s, today(s))
        #expect(c.since == 8)
        #expect(abs(c.today - 8.0 / 14) < 1e-9)
        #expect(c.marks.map(\.p) == [10.0 / 14, 12.0 / 14, 13.0 / 14, 1])
        #expect(c.marks.last?.kind == .pay)
    }

    @Test func splitAddsBackUpToThisMorningsCash() {
        for scenario in Scenario.allCases {
            let s = scenario.snapshot, t = today(s)
            if t.pool < 0 { continue }
            let sum = splitToday(s, t).reduce(0) { $0 + $1.amount }
            #expect(abs(sum - t.startCash) < 1e-6)
        }
    }

    @Test func splitShowsOnlyWhatsOwedWhenCashFallsShort() {
        let s = Scenario.storm.snapshot, t = today(s)
        let parts = splitToday(s, t)
        #expect(t.pool < 0)
        #expect(parts.first { $0.key == .today }?.amount == 0)
        #expect(!parts.contains { $0.key == .later })
    }
}
