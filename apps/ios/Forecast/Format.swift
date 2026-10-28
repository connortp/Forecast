import Foundation

// Mirrors apps/web/src/lib/format.ts.
enum Fmt {
    static func money(_ n: Double) -> String {
        let whole = Int(abs(n).rounded())
        return (n < 0 ? "−" : "") + "$" + whole.formatted(.number.grouping(.automatic).locale(Locale(identifier: "en_US")))
    }

    static func whole(_ n: Double) -> String {
        Int(n.rounded()).formatted(.number.locale(Locale(identifier: "en_US")))
    }

    private static func at(_ d: Int) -> Date {
        Calendar.current.date(byAdding: .day, value: d, to: Calendar.current.startOfDay(for: .now)) ?? .now
    }

    static func dayName(_ d: Int) -> String {
        d == 0 ? "Today" : d == 1 ? "Tmrw" : at(d).formatted(.dateTime.weekday(.abbreviated))
    }

    static func shortDate(_ d: Int) -> String { at(d).formatted(.dateTime.month(.abbreviated).day()) }
    static func longDate(_ d: Int) -> String { at(d).formatted(.dateTime.weekday(.wide).month(.wide).day()) }
}
