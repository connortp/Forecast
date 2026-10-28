// What sign-up "finds" until Plaid is connected, mirroring
// apps/web/src/components/onboarding/example.ts. Nothing here is a real account.
// Offsets are days from today, the same as the engine.

public enum SignupExample {
    public struct Account: Sendable, Hashable {
        public var name: String
        public var mask: String
        public var balance: Double
        public var countsAsCash: Bool
        public var selected: Bool
        public var note: String?
    }

    public struct FoundBill: Sendable, Hashable {
        public var name: String
        public var payee: String?
        public var amount: Double
        public var dueIn: Int
        public var unsure: Bool
    }

    public struct Cadence: Sendable, Hashable, Identifiable {
        public var label: String
        public var chip: String
        public var every: Int
        public var id: Int { every }
    }

    public static let bank = "Harbor Federal"
    public static let transactions = 1284
    public static let employer = "Acme Studio payroll"
    public static let paycheckAmount: Double = 2140
    public static let paycheckNextIn = 9
    public static let typicalDay: Double = 85
    public static let recentPace: Double = 80

    public static let accounts = [
        Account(name: "Everyday Checking", mask: "4021", balance: 2486, countsAsCash: true, selected: true),
        Account(name: "High-Yield Savings", mask: "8830", balance: 6210, countsAsCash: false, selected: false, note: "not counted as cash"),
        Account(name: "Cash Back Visa", mask: "1177", balance: 412, countsAsCash: false, selected: true, note: "for statement due dates"),
    ]

    public static let bills = [
        FoundBill(name: "Rent", payee: "Greenline Properties", amount: 1200, dueIn: 4, unsure: false),
        FoundBill(name: "Verizon", amount: 65, dueIn: 5, unsure: false),
        FoundBill(name: "Spotify", amount: 11.99, dueIn: 6, unsure: false),
        FoundBill(name: "Geico", amount: 118, dueIn: 8, unsure: false),
        FoundBill(name: "Venmo to Sam", payee: "repeats monthly", amount: 40, dueIn: 7, unsure: true),
    ]

    public static let cadences = [
        Cadence(label: "every week", chip: "Weekly", every: 7),
        Cadence(label: "every other Friday", chip: "Every 2 weeks", every: 14),
        Cadence(label: "twice a month", chip: "1st & 15th", every: 15),
        Cadence(label: "once a month", chip: "Monthly", every: 30),
    ]

    public struct Choices: Sendable, Hashable {
        public var every = 14
        public var billsOn = SignupExample.bills.map { !$0.unsure }
        public var buckets = [
            Bucket(name: "Emergency fund", saved: 0, goal: 3000, perPaycheck: 100),
            Bucket(name: "Japan trip", saved: 0, goal: 2400, perPaycheck: 120),
        ]
        public var cushion: Double = 150
        public init() {}
    }

    /// Turns what the person confirmed into the engine's input.
    public static func snapshot(_ c: Choices) -> Snapshot {
        let cash = accounts.filter { $0.countsAsCash && $0.selected }.reduce(0) { $0 + $1.balance }
        let held = zip(bills, c.billsOn).filter { $0.1 }.map { Bill(name: $0.0.name, amount: $0.0.amount, dueIn: $0.0.dueIn, every: 30) }
        return Snapshot(cash: cash, spentToday: 0,
                        paycheck: Paycheck(amount: paycheckAmount, nextIn: paycheckNextIn, every: c.every),
                        bills: held, buckets: c.buckets, cushion: c.cushion,
                        typicalDay: typicalDay, recentPace: recentPace)
    }
}
