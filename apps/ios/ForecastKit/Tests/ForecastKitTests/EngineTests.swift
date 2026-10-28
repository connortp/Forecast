// The same cases as apps/web/src/lib/engine.test.ts, so both apps agree on the number.
import Testing
@testable import ForecastKit

let simple = Snapshot(
    cash: 1000, spentToday: 0,
    paycheck: Paycheck(amount: 2000, nextIn: 5, every: 14),
    bills: [Bill(name: "Rent", amount: 400, dueIn: 2, every: 30)],
    buckets: [Bucket(name: "Rainy day", saved: 0, goal: 1000, perPaycheck: 100)],
    cushion: 100, typicalDay: 50, recentPace: 50
)

@Suite struct TodayTests {
    @Test func spreadsCashAfterBillsAndCushionOverDaysUntilPayday() {
        let t = today(simple)
        #expect(t.until == 5)
        #expect(t.bills == 400)
        #expect(t.saving == 0) // savings come out of the paycheck, not this cycle
        #expect(t.pool == 500)
        #expect(t.daily == 100)
        #expect(t.safeToSpend == 100)
        #expect(t.condition == .sunny)
    }

    @Test func subtractsSpentTodayWithoutChangingDailyShare() {
        var s = simple
        s.cash = 960; s.spentToday = 40
        let t = today(s)
        #expect(t.daily == 100)
        #expect(t.safeToSpend == 60)
    }

    @Test func neverGoesBelowZeroAndReportsStormWhenShort() {
        var s = simple
        s.cash = 300
        let t = today(s)
        #expect(t.pool < 0)
        #expect(t.safeToSpend == 0)
        #expect(t.condition == .storm)
    }
}

@Test func eventsRepeatBillsAndPaySavingsFirstOnPayday() {
    let e = events(simple, from: 0, to: 40)
    #expect(e.filter { $0.name == "Rent" }.map(\.day) == [2, 32])
    #expect(e.filter { $0.day == 5 }.map(\.kind) == [.pay, .save])
}

@Test func outlookRollsUnspentMoneyForwardAndResetsOnPayday() {
    let o = outlook(simple, days: 10)
    #expect(o.count == 10)
    // Spending a typical $50 of a $100 allowance leaves more for each following day.
    #expect(o[1].daily > o[0].daily)
    #expect(o[5].payday)
    #expect(o[5].condition == .sunny)
}

@Test func conditionMapsRatioToNormalDayOntoWeather() {
    #expect(condition(daily: 100, typicalDay: 70) == .sunny)
    #expect(condition(daily: 70, typicalDay: 70) == .partly)
    #expect(condition(daily: 50, typicalDay: 70) == .cloudy)
    #expect(condition(daily: 25, typicalDay: 70) == .rain)
    #expect(condition(daily: 10, typicalDay: 70) == .storm)
}

@Test func sampleScenariosCoverEveryKindOfWeather() {
    #expect(Scenario.allCases.map { today($0.snapshot).condition } == [.sunny, .partly, .rain, .storm])
    #expect(today(Scenario.partly.snapshot).safeToSpend.rounded() == 57)
}
