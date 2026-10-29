// The same cases as apps/web/src/components/onboarding/example.test.ts.
import Testing
@testable import ForecastKit

@Suite struct SignupExampleTests {
    @Test func revealsTheSameNumberAsTheWeb() {
        let t = today(SignupExample.snapshot(.init()))
        // (2486 − 1394.99 bills − 150 cushion) ÷ 9 days
        #expect(Int(t.safeToSpend.rounded()) == 105)
        #expect(t.billCount == 4)
        #expect(t.condition == .partly)
    }

    @Test func bucketsDoNotLowerTodayBeforeTheNextPaycheck() {
        var c = SignupExample.Choices()
        let before = today(SignupExample.snapshot(c)).safeToSpend
        c.buckets[0].perPaycheck = 500
        #expect(today(SignupExample.snapshot(c)).safeToSpend == before)
    }

    @Test func countsABillOnceItIsSwitchedOn() {
        var c = SignupExample.Choices()
        let before = today(SignupExample.snapshot(c)).pool
        c.billsOn[4] = true
        #expect(abs(today(SignupExample.snapshot(c)).pool - (before - 40)) < 0.001)
    }
}
