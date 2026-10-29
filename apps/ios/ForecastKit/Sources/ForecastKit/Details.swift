// The numbers behind the drawn cards under the hero. A port of apps/web/src/lib/details.ts;
// DetailsTests mirror details.test.ts.

public struct CycleMark: Sendable, Hashable {
    public var p: Double
    public var kind: Event.Kind
}

public struct Cycle: Sendable, Hashable {
    /// Days since the last paycheck.
    public var since: Int
    /// Where today sits: 0 is the last paycheck, 1 the next.
    public var today: Double
    public var marks: [CycleMark]
}

/// Where today sits in the pay cycle, and every bill on the way to the next paycheck.
public func cycle(_ s: Snapshot, _ t: Today) -> Cycle {
    let every = max(1, s.paycheck.every, t.until)
    let since = max(0, every - t.until)
    var marks = events(s, from: 0, to: t.until)
        .filter { $0.kind == .bill }
        .map { CycleMark(p: Double(since + $0.day) / Double(every), kind: .bill) }
    marks.append(CycleMark(p: 1, kind: .pay))
    return Cycle(since: since, today: Double(since) / Double(every), marks: marks)
}

public struct Split: Sendable, Hashable {
    public enum Key: String, Sendable { case bills, savings, cushion, later, today }
    public var key: Key
    public var label: String
    public var amount: Double
}

/// This morning's cash, split the way the engine spends it. Parts sum to the cash unless it falls short.
public func splitToday(_ s: Snapshot, _ t: Today) -> [Split] {
    let daily = max(0, t.daily)
    let later = max(0, t.pool - daily)
    let rest = t.until - 1
    let parts = [
        Split(key: .bills, label: "Bills before payday (\(t.billCount))", amount: t.bills),
        Split(key: .savings, label: "To savings before payday", amount: t.saving),
        Split(key: .cushion, label: "Cushion", amount: s.cushion),
        Split(key: .later, label: "The \(rest) day\(rest == 1 ? "" : "s") after today", amount: later),
        Split(key: .today, label: "Today", amount: daily),
    ]
    return parts.filter { $0.key == .bills || $0.key == .today || $0.amount > 0 }
}
