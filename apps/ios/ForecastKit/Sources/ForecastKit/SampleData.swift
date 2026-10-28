// Example data for the prototype, mirroring apps/web/src/lib/sample-data.ts.
// Nothing here is a real account.

public enum Scenario: String, CaseIterable, Identifiable, Sendable {
    case sunny, partly, rain, storm

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .sunny: "Just paid"
        case .partly: "Mid-cycle"
        case .rain: "Rent week"
        case .storm: "Overspent"
        }
    }

    public var snapshot: Snapshot {
        let buckets = [
            Bucket(name: "Emergency fund", saved: 4200, goal: 10000, perPaycheck: 200),
            Bucket(name: "Japan, spring '27", saved: 1150, goal: 3000, perPaycheck: 150),
            Bucket(name: "New laptop", saved: 600, goal: 1800, perPaycheck: 100),
        ]
        func pay(_ nextIn: Int) -> Paycheck { Paycheck(amount: 2650, nextIn: nextIn, every: 14) }
        func monthly(_ name: String, _ amount: Double, _ dueIn: Int) -> Bill { Bill(name: name, amount: amount, dueIn: dueIn, every: 30) }
        func make(cash: Double, spentToday: Double, recentPace: Double, paycheck: Paycheck, bills: [Bill]) -> Snapshot {
            Snapshot(cash: cash, spentToday: spentToday, paycheck: paycheck, bills: bills, buckets: buckets,
                     cushion: 150, typicalDay: 70, recentPace: recentPace)
        }

        switch self {
        case .sunny:
            return make(cash: 3420, spentToday: 18, recentPace: 58, paycheck: pay(13),
                        bills: [monthly("Rent", 1450, 9), monthly("Phone", 85, 4), monthly("Spotify", 12, 6), monthly("Car insurance", 142, 11)])
        case .partly:
            return make(cash: 820, spentToday: 24, recentPace: 74, paycheck: pay(6),
                        bills: [monthly("Electric", 96, 2), monthly("Internet", 70, 4), monthly("Gym", 45, 5), monthly("Rent", 1450, 23)])
        case .rain:
            return make(cash: 1790, spentToday: 12, recentPace: 81, paycheck: pay(5),
                        bills: [monthly("Rent", 1450, 2), monthly("Phone", 85, 3), monthly("Car payment", 389, 15)])
        case .storm:
            return make(cash: 640, spentToday: 0, recentPace: 112, paycheck: pay(4),
                        bills: [monthly("Car payment", 389, 1), monthly("Car insurance", 142, 3), monthly("Rent", 1450, 17)])
        }
    }
}
