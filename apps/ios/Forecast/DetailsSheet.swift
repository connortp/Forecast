import SwiftUI
import ForecastKit

/// Everything below the fold: the cards that explain the number.
struct DetailsSheet<Footer: View>: View {
    var snapshot: Snapshot
    var today: Today
    var tone: Tone
    var night: Bool
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(spacing: 14) {
            Capsule().fill(.white.opacity(0.18)).frame(width: 38, height: 4).padding(.bottom, 4)
            TodayCard(snapshot: snapshot, today: today, tone: tone, night: night)
            UntilPaydayCard(snapshot: snapshot, today: today)
            OutlookCard(snapshot: snapshot)
            HStack(alignment: .top, spacing: 14) {
                PaceCard(snapshot: snapshot, safeDaily: max(0, today.daily))
                CushionCard(cushion: snapshot.cushion)
            }
            .fixedSize(horizontal: false, vertical: true)
            ShelteredCard(buckets: snapshot.buckets)
            MathCard(snapshot: snapshot, today: today)
            footer
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 48)
        .frame(maxWidth: 600)
        .frame(maxWidth: .infinity)
        .background {
            UnevenRoundedRectangle(topLeadingRadius: 28, topTrailingRadius: 28)
                .fill(Palette.sheet)
                .shadow(color: .black.opacity(0.25), radius: 30, y: -15)
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

// MARK: - Card chrome

private struct Card<Content: View>: View {
    var title: String
    var detail: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Eyebrow(text: title)
                Spacer(minLength: 12)
                if let detail {
                    Text(detail).font(Typography.sans(12.5)).foregroundStyle(Palette.ink2)
                }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            LinearGradient(colors: [Palette.cardHi, Palette.card], startPoint: .top, endPoint: .init(x: 0.5, y: 0.7)),
            in: RoundedRectangle(cornerRadius: 22, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Palette.line))
    }
}

private struct Lede: View {
    var text: AttributedString
    var body: some View {
        Text(text)
            .font(Typography.serif(23))
            .lineSpacing(1)
            .foregroundStyle(Palette.ink)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Builds serif lede text with the amounts picked out in the sun color.
private func lede(_ parts: [(String, Bool)]) -> AttributedString {
    parts.reduce(into: AttributedString()) { out, part in
        var piece = AttributedString(part.0)
        if part.1 { piece.foregroundColor = Palette.sun }
        out += piece
    }
}

// MARK: - Cards

private struct TodayCard: View {
    var snapshot: Snapshot
    var today: Today
    var tone: Tone
    var night: Bool

    var body: some View {
        Card(title: "Today's forecast") {
            HStack(spacing: 10) {
                WeatherIcon(condition: today.condition, night: night).font(Typography.sans(26))
                Text(night && today.condition == .sunny ? "Clear night" : today.condition.name)
                    .font(Typography.sans(19, weight: 500))
            }
            Text(quip)
                .font(Typography.serif(26, italic: true))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 4)
            Divider().overlay(Palette.line)
            HStack(spacing: 0) {
                stat("Payday", today.until == 1 ? "Tomorrow" : "\(today.until) days")
                stat("Bills ahead", Fmt.money(today.bills)).padding(.leading, 14).overlay(alignment: .leading) { rule }
                stat("Spent today", Fmt.money(snapshot.spentToday)).padding(.leading, 14).overlay(alignment: .leading) { rule }
            }
        }
    }

    private var quip: String {
        today.pool < 0 && tone == .calm
            ? "You're \(Fmt.money(-today.pool)) short of covering bills before payday. Today stays at $0 until it lands."
            : today.condition.quip(tone)
    }

    private var rule: some View { Rectangle().fill(Palette.line).frame(width: 1) }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(Typography.sans(12)).foregroundStyle(Palette.ink3)
            Text(value).font(Typography.mono(17)).monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct UntilPaydayCard: View {
    var snapshot: Snapshot
    var today: Today

    var body: some View {
        let timeline = events(snapshot, from: 0, to: today.until + 1).filter { $0.kind != .save }
        Card(title: "Until payday", detail: "\(Fmt.shortDate(0)) – \(Fmt.shortDate(today.until))") {
            if today.billCount > 0 {
                Lede(text: lede([
                    ("\(today.billCount) bill\(today.billCount > 1 ? "s" : "") worth ", false), (Fmt.money(today.bills), true),
                    (" land before your paycheck on \(Fmt.longDate(today.until)). They're already set aside.", false),
                ]))
            } else {
                Lede(text: lede([("Nothing due before your paycheck on \(Fmt.longDate(today.until)).", false)]))
            }
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 0) {
                    stop(when: "Now", amount: Fmt.money(today.safeToSpend), what: "left today", kind: nil)
                    ForEach(Array(timeline.enumerated()), id: \.offset) { _, e in
                        stop(when: Fmt.dayName(e.day), amount: (e.kind == .pay ? "+" : "−") + Fmt.money(e.amount), what: e.name, kind: e.kind)
                    }
                }
                .padding(.horizontal, 18)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -18)
        }
    }

    private func stop(when: String, amount: String, what: String, kind: Event.Kind?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(when).font(Typography.sans(12.5, weight: 500)).foregroundStyle(Palette.ink2)
            ZStack {
                switch kind {
                case nil:
                    Circle().fill(Palette.sun)
                    Circle().fill(Color(hex: 0x121826)).frame(width: 6)
                case .pay:
                    Circle().fill(Palette.good.opacity(0.14)).overlay(Circle().strokeBorder(Palette.good.opacity(0.4)))
                    Image(systemName: "arrow.up").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.good)
                default:
                    Circle().fill(Color(hex: 0x222B3A)).overlay(Circle().strokeBorder(.white.opacity(0.1)))
                    Image(systemName: "arrow.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.ink)
                }
            }
            .frame(width: 28, height: 28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .center) { Rectangle().fill(Palette.line).frame(height: 1).padding(.leading, kind == nil ? 14 : 0) }
            Text(amount).font(Typography.mono(13.5, weight: 500)).foregroundStyle(kind == .pay ? Palette.good : Palette.ink)
            Text(what).font(Typography.sans(12)).foregroundStyle(Palette.ink3).lineLimit(1).padding(.top, -6)
        }
        .frame(width: 84, alignment: .leading)
    }
}

private struct OutlookCard: View {
    var snapshot: Snapshot

    private static let barColor: [Condition: Color] = [
        .sunny: Color(hex: 0xFFC65C), .partly: Color(hex: 0xFFE3A3), .cloudy: Color(hex: 0xC9D3E3), .rain: Color(hex: 0x8DB8FF), .storm: Color(hex: 0xFF8D7A),
    ]

    var body: some View {
        let days = outlook(snapshot, days: 10)
        let top = max(days.map { max(0, $0.daily) }.max() ?? 0, snapshot.typicalDay * 1.6)
        Card(title: "10-day outlook", detail: "daily safe-to-spend") {
            VStack(spacing: 0) {
                ForEach(days, id: \.day) { d in
                    let v = max(0, d.daily)
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Fmt.dayName(d.day)).font(Typography.sans(15, weight: 500))
                            if d.payday {
                                Text("PAYDAY").font(Typography.mono(9.5, weight: 600)).tracking(0.8).foregroundStyle(Palette.good)
                            }
                        }
                        .frame(width: 58, alignment: .leading)
                        WeatherIcon(condition: d.condition).font(Typography.sans(20)).frame(width: 30)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(.white.opacity(0.06))
                                Capsule()
                                    .fill(LinearGradient(colors: [.white.opacity(0.12), Self.barColor[d.condition]!], startPoint: .leading, endPoint: .trailing))
                                    .frame(width: max(geo.size.width * 0.02, geo.size.width * v / top))
                                Rectangle().fill(.white.opacity(0.35)).frame(width: 1, height: 14)
                                    .offset(x: geo.size.width * snapshot.typicalDay / top)
                            }
                            .frame(height: 6)
                            .frame(maxHeight: .infinity)
                        }
                        Text(Fmt.money(v)).font(Typography.mono(14.5, weight: 500)).frame(width: 60, alignment: .trailing)
                    }
                    .frame(height: 48)
                    .overlay(alignment: .top) { if d.day > 0 { Rectangle().fill(Palette.line).frame(height: 1) } }
                }
            }
            HStack(spacing: 8) {
                Rectangle().fill(.white.opacity(0.35)).frame(width: 1, height: 12)
                Text("Your typical day, learned from 90 days").font(Typography.sans(12)).foregroundStyle(Palette.ink3)
            }
        }
    }
}

private struct PaceCard: View {
    var snapshot: Snapshot
    var safeDaily: Double

    var body: some View {
        let pace = snapshot.recentPace
        let scale = max(max(pace, safeDaily) * 1.25, 1)
        Card(title: "Spending pace") {
            Text("\(Fmt.money(pace))/day").font(Typography.serif(30, weight: 350)).lineLimit(1).minimumScaleFactor(0.7)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.06))
                    Capsule().fill(pace > safeDaily ? Palette.bad : Palette.good).frame(width: geo.size.width * pace / scale)
                    RoundedRectangle(cornerRadius: 1).fill(Palette.ink).frame(width: 2, height: 14).offset(x: geo.size.width * safeDaily / scale - 1)
                }
                .frame(height: 6)
            }
            .frame(height: 14)
            Spacer(minLength: 0)
            Text("Past 7 days, \(pace > safeDaily ? "above" : "under") the safe pace of \(Fmt.money(safeDaily)) (white mark).")
                .font(Typography.sans(13)).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct CushionCard: View {
    var cushion: Double

    var body: some View {
        Card(title: "Cushion") {
            Text(Fmt.money(cushion)).font(Typography.serif(30, weight: 350))
            Spacer(minLength: 0)
            Text("Held back so a surprise charge never overdraws you. Adjustable.")
                .font(Typography.sans(13)).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct ShelteredCard: View {
    var buckets: [Bucket]

    var body: some View {
        let perPaycheck = buckets.reduce(0) { $0 + $1.perPaycheck }
        Card(title: "Sheltered", detail: "\(Fmt.money(buckets.reduce(0) { $0 + $1.saved })) saved") {
            Lede(text: lede([(Fmt.money(perPaycheck), true), (" moves here from every paycheck before anything counts as spendable.", false)]))
            VStack(spacing: 10) {
                ForEach(Array(buckets.enumerated()), id: \.offset) { i, b in
                    let p = b.saved / b.goal
                    HStack(spacing: 14) {
                        ZStack {
                            Circle().stroke(.white.opacity(0.08), lineWidth: 5)
                            Circle().trim(from: 0, to: p)
                                .stroke(Palette.buckets[i % Palette.buckets.count], style: StrokeStyle(lineWidth: 5, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                            Text("\(Int((p * 100).rounded()))%").font(Typography.mono(10.5))
                        }
                        .frame(width: 42, height: 42)
                        .padding(3)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(b.name).font(Typography.sans(15, weight: 500))
                                Spacer(minLength: 8)
                                Text("\(Fmt.money(b.saved)) / \(Fmt.money(b.goal))").font(Typography.mono(12.5)).foregroundStyle(Palette.ink2)
                            }
                            Text("+\(Fmt.money(b.perPaycheck)) each paycheck · done in about \(Int(((b.goal - b.saved) / b.perPaycheck / 2).rounded(.up))) months")
                                .font(Typography.sans(12.5)).foregroundStyle(Palette.ink3)
                        }
                    }
                    .padding(12)
                    .background(.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line))
                }
            }
        }
    }
}

private struct MathCard: View {
    var snapshot: Snapshot
    var today: Today

    var body: some View {
        let safeDaily = max(0, today.daily)
        Card(title: "How today's number is made") {
            VStack(spacing: 0) {
                row("Cash in checking this morning", Fmt.money(today.startCash))
                row("Bills before payday (\(today.billCount))", "−" + Fmt.money(today.bills))
                if today.saving > 0 { row("Savings due before payday", "−" + Fmt.money(today.saving)) }
                row("Cushion", "−" + Fmt.money(snapshot.cushion))
                row("Spread over \(today.until) day\(today.until > 1 ? "s" : "") until payday", Fmt.money(today.pool), rule: true)
                row("Per day", Fmt.money(safeDaily))
                row("Spent so far today", (snapshot.spentToday > 0 ? "−" : "") + Fmt.money(snapshot.spentToday))
                row("Safe to spend today", Fmt.money(today.safeToSpend), rule: true, total: true)
            }
        }
    }

    private func row(_ label: String, _ value: String, rule: Bool = false, total: Bool = false) -> some View {
        HStack {
            Text(label).font(Typography.sans(14, weight: total ? 500 : 400)).foregroundStyle(total ? Palette.ink : Palette.ink2)
            Spacer()
            Text(value).font(Typography.mono(total ? 15 : 13.5, weight: total ? 500 : 400)).foregroundStyle(total ? Palette.sun : Palette.ink)
        }
        .padding(.vertical, 7)
        .padding(.top, rule ? 4 : 0)
        .overlay(alignment: .top) { if rule { Rectangle().fill(Palette.line).frame(height: 1) } }
    }
}
