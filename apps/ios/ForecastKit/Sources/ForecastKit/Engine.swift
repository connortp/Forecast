// The safe-to-spend engine, ported from apps/web/src/lib/engine.ts. Keep the two in step.
//
// Everything is measured in whole days from "today" (day 0) so the engine stays pure
// and easy to test. Adapters turn real dates from Plaid/Supabase into these offsets.
//
// The rule: cash this morning, minus every bill due before the next paycheck, minus
// savings contributions due before then, minus a cushion, spread evenly over the days
// until payday. Whatever is left of today's share after today's spending is the number.

public struct Bill: Sendable, Hashable {
    public var name: String
    public var amount: Double
    /// Days from today until the next charge.
    public var dueIn: Int
    /// How often it repeats, in days. Monthly bills use 30.
    public var every: Int

    public init(name: String, amount: Double, dueIn: Int, every: Int) {
        self.name = name; self.amount = amount; self.dueIn = dueIn; self.every = every
    }
}

public struct Paycheck: Sendable, Hashable {
    public var amount: Double
    /// Days from today until the next deposit (at least 1).
    public var nextIn: Int
    public var every: Int

    public init(amount: Double, nextIn: Int, every: Int) {
        self.amount = amount; self.nextIn = nextIn; self.every = every
    }
}

public struct Bucket: Sendable, Hashable {
    public var name: String
    public var saved: Double
    public var goal: Double
    /// Moved out of each paycheck before anything counts as spendable.
    public var perPaycheck: Double

    public init(name: String, saved: Double, goal: Double, perPaycheck: Double) {
        self.name = name; self.saved = saved; self.goal = goal; self.perPaycheck = perPaycheck
    }
}

public struct Snapshot: Sendable, Hashable {
    /// Spendable balance right now, across checking accounts.
    public var cash: Double
    public var spentToday: Double
    public var paycheck: Paycheck
    public var bills: [Bill]
    public var buckets: [Bucket]
    public var cushion: Double
    /// A normal day of discretionary spending, learned from history.
    public var typicalDay: Double
    /// Average daily discretionary spend over the last 7 days.
    public var recentPace: Double

    public init(cash: Double, spentToday: Double, paycheck: Paycheck, bills: [Bill], buckets: [Bucket],
                cushion: Double, typicalDay: Double, recentPace: Double) {
        self.cash = cash; self.spentToday = spentToday; self.paycheck = paycheck; self.bills = bills
        self.buckets = buckets; self.cushion = cushion; self.typicalDay = typicalDay; self.recentPace = recentPace
    }
}

public struct Event: Sendable, Hashable {
    public enum Kind: Int, Sendable { case pay, save, bill } // raw value is the same-day sort order

    public var day: Int
    public var name: String
    public var amount: Double
    public var kind: Kind
}

public enum Condition: String, Sendable, CaseIterable {
    case sunny, partly, cloudy, rain, storm
}

public struct Allowance: Sendable, Hashable {
    /// Day of the next paycheck after this day.
    public var until: Int
    public var bills: Double
    public var billCount: Int
    public var saving: Double
    /// Money left to cover every day until payday. Negative means short.
    public var pool: Double
    public var daily: Double
}

public struct Today: Sendable, Hashable {
    public var allowance: Allowance
    public var startCash: Double
    public var safeToSpend: Double
    public var condition: Condition

    public var until: Int { allowance.until }
    public var bills: Double { allowance.bills }
    public var billCount: Int { allowance.billCount }
    public var saving: Double { allowance.saving }
    public var pool: Double { allowance.pool }
    public var daily: Double { allowance.daily }
}

public struct OutlookDay: Sendable, Hashable {
    public var day: Int
    public var daily: Double
    public var payday: Bool
    public var condition: Condition
}

public func events(_ s: Snapshot, from: Int, to: Int) -> [Event] {
    var out: [Event] = []
    for b in s.bills {
        var d = b.dueIn
        while d < to {
            if d >= from { out.append(Event(day: d, name: b.name, amount: b.amount, kind: .bill)) }
            d += b.every
        }
    }
    let saving = s.buckets.reduce(0) { $0 + $1.perPaycheck }
    var d = s.paycheck.nextIn
    while d < to {
        if d >= from {
            out.append(Event(day: d, name: "Paycheck", amount: s.paycheck.amount, kind: .pay))
            if saving > 0 { out.append(Event(day: d, name: "To savings", amount: saving, kind: .save)) }
        }
        d += s.paycheck.every
    }
    // Stable sort, like Array.prototype.sort, so same-day bills keep their order.
    return out.enumerated()
        .sorted { ($0.element.day, $0.element.kind.rawValue, $0.offset) < ($1.element.day, $1.element.kind.rawValue, $1.offset) }
        .map(\.element)
}

public func nextPaycheck(_ s: Snapshot, after day: Int) -> Int {
    var d = s.paycheck.nextIn
    while d <= day { d += s.paycheck.every }
    return d
}

/// The allowance for one day, given the cash on hand at the start of that day.
public func allowance(_ s: Snapshot, on day: Int, cashAtStart: Double) -> Allowance {
    let until = nextPaycheck(s, after: day)
    let held = events(s, from: day, to: until).filter { $0.kind != .pay }
    let billList = held.filter { $0.kind == .bill }
    let bills = billList.reduce(0) { $0 + $1.amount }
    let saving = held.filter { $0.kind == .save }.reduce(0) { $0 + $1.amount }
    let pool = cashAtStart - bills - saving - s.cushion
    return Allowance(until: until, bills: bills, billCount: billList.count, saving: saving, pool: pool,
                     daily: pool / Double(until - day))
}

private let thresholds: [(Condition, Double)] = [(.sunny, 1.25), (.partly, 0.95), (.cloudy, 0.65), (.rain, 0.3)]

/// Weather is how today's allowance compares with a normal day for this person.
public func condition(daily: Double, typicalDay: Double) -> Condition {
    if daily <= 0 || typicalDay <= 0 { return daily > 0 ? .sunny : .storm }
    let ratio = daily / typicalDay
    return thresholds.first { ratio >= $0.1 }?.0 ?? .storm
}

public func today(_ s: Snapshot) -> Today {
    let startCash = s.cash + s.spentToday
    let a = allowance(s, on: 0, cashAtStart: startCash)
    return Today(allowance: a, startCash: startCash, safeToSpend: max(0, a.daily - s.spentToday),
                 condition: condition(daily: a.daily, typicalDay: s.typicalDay))
}

/// Projects the daily allowance forward, assuming a typical day of spending.
public func outlook(_ s: Snapshot, days: Int = 10) -> [OutlookDay] {
    var cash = s.cash + s.spentToday
    var out: [OutlookDay] = []
    for d in 0..<days {
        let todays = events(s, from: d, to: d + 1)
        let pay = todays.first { $0.kind == .pay }
        if let pay { cash += pay.amount }
        let a = allowance(s, on: d, cashAtStart: cash)
        out.append(OutlookDay(day: d, daily: a.daily, payday: pay != nil,
                              condition: condition(daily: a.daily, typicalDay: s.typicalDay)))
        cash -= d == 0 ? s.spentToday : max(0, min(s.typicalDay, a.daily))
        for e in todays where e.kind != .pay { cash -= e.amount }
    }
    return out
}
