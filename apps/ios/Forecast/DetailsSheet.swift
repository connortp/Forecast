import SwiftUI
import ForecastKit

/// Everything under the number, in the sign-up flow's language: frosted cards over the blurred sky,
/// a light serif headline with one italic word, and a drawn graphic that says it before the words do.
/// apps/web/src/components/Details.tsx draws the same cards; keep the two in step.
struct DetailsSheet<Footer: View>: View {
    var snapshot: Snapshot
    var today: Today
    var tone: Tone
    var night: Bool
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(spacing: 14) {
            TodayIntro(snapshot: snapshot, today: today, tone: tone, night: night)
            CycleCard(snapshot: snapshot, today: today)
            OutlookCard(snapshot: snapshot)
            MathCard(snapshot: snapshot, today: today)
            SavingsCard(buckets: snapshot.buckets)
            HStack(alignment: .top, spacing: 14) {
                PaceTile(snapshot: snapshot, safe: max(0, today.daily))
                CushionTile(cushion: snapshot.cushion)
            }
            .fixedSize(horizontal: false, vertical: true)
            footer
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.bottom, 48)
        .frame(maxWidth: 600)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Type and chrome

/// A light serif headline whose last word is in italic, the way the site and sign-up set them.
private func headline(_ text: String, size: CGFloat = 32) -> Text {
    let trimmed = text.hasSuffix(".") ? String(text.dropLast()) : text
    let split = trimmed.range(of: " ", options: .backwards)
    let lead = split.map { String(trimmed[..<$0.upperBound]) } ?? ""
    let last = split.map { String(trimmed[$0.upperBound...]) } ?? trimmed
    return Text(lead).font(Typography.serif(size, weight: 300))
        + Text(last).font(Typography.serif(size, weight: 300, italic: true))
        + Text(".").font(Typography.serif(size, weight: 300))
}

private struct Card<Content: View>: View {
    var eyebrow: String
    var title: String?
    var spacing: CGFloat = 14
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            Eyebrow(text: eyebrow, color: .white.opacity(0.62))
            if let title { headline(title).tracking(-0.4).fixedSize(horizontal: false, vertical: true) }
            content
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .glass(radius: 20)
    }
}

private extension View {
    /// The frosted card used across sign-up.
    func glass(radius: CGFloat = 16) -> some View {
        background(.ultraThinMaterial.opacity(0.6), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(.white.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(.white.opacity(0.14)))
    }
}

private struct Para: View {
    var text: String
    var body: some View {
        Text(text).font(Typography.sans(14.5)).foregroundStyle(.white.opacity(0.74)).fixedSize(horizontal: false, vertical: true)
    }
}

private struct Fine: View {
    var text: String
    var body: some View {
        Text(text).font(Typography.sans(12.5)).foregroundStyle(.white.opacity(0.48)).fixedSize(horizontal: false, vertical: true)
    }
}

private struct Rule: View {
    var opacity = 0.1
    var body: some View { Rectangle().fill(.white.opacity(opacity)).frame(height: 1) }
}

private func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }

// MARK: - Cards

/// The opening: today's weather, the quip as the headline, and three readings.
private struct TodayIntro: View {
    var snapshot: Snapshot
    var today: Today
    var tone: Tone
    var night: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Eyebrow(text: "Today's forecast · \(night && today.condition == .sunny ? "Clear night" : today.condition.name)", color: .white.opacity(0.62))
            headline(quip, size: 38).tracking(-0.8).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 0) {
                reading("Payday", today.until == 1 ? "Tomorrow" : "\(today.until) days")
                reading(today.pool < 0 ? "Short" : "Bills held", Fmt.money(today.pool < 0 ? -today.pool : today.bills), rule: true)
                reading("Spent today", Fmt.money(snapshot.spentToday), rule: true)
            }
            .padding(.vertical, 16)
            .glass(radius: 20)
        }
        .padding(.horizontal, 4)
        .padding(.top, 28)
        .padding(.bottom, 10)
    }

    private var quip: String {
        today.pool < 0 && tone == .calm
            ? "You're \(Fmt.money(-today.pool)) short of covering bills before payday. Today stays at $0 until it lands."
            : today.condition.quip(tone)
    }

    private func reading(_ label: String, _ value: String, rule: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: label, color: .white.opacity(0.58)).lineLimit(1)
            Text(value).font(Typography.serif(24, weight: 300)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) { if rule { Rectangle().fill(.white.opacity(0.12)).frame(width: 1) } }
    }
}

/// The pay cycle as a sun path: the arc runs from the last paycheck to the next, the sun sits on
/// today, and every bill before payday is a mark on the way.
private struct CycleCard: View {
    var snapshot: Snapshot
    var today: Today

    var body: some View {
        let c = cycle(snapshot, today)
        let upcoming = events(snapshot, from: 0, to: today.until + 1).filter { $0.kind != .save }
        Card(eyebrow: "Pay cycle · \(Fmt.shortDate(-c.since)) – \(Fmt.shortDate(today.until))",
             title: today.until == 1 ? "Payday is tomorrow." : "\(plural(today.until, "day")) to payday.") {
            SunPath(cycle: c)
                .frame(height: 150)
                .accessibilityLabel("Day \(c.since + 1) of a \(snapshot.paycheck.every)-day pay cycle, \(plural(today.billCount, "bill")) before payday")
            HStack {
                end("Last paycheck", Fmt.shortDate(-c.since), .leading)
                Spacer()
                end("Next paycheck", Fmt.shortDate(today.until), .trailing)
            }
            .padding(.top, -6)
            VStack(spacing: 0) {
                ForEach(Array(upcoming.enumerated()), id: \.offset) { i, e in
                    HStack(alignment: .firstTextBaseline) {
                        Circle().strokeBorder(e.kind == .pay ? Palette.payLine : .white.opacity(0.8), lineWidth: 1.3)
                            .background(Circle().fill(e.kind == .pay ? Palette.pay : .clear))
                            .frame(width: 7, height: 7)
                            .padding(.trailing, 4)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(e.name).font(Typography.sans(14))
                            Text("\(Fmt.dayName(e.day)) · \(Fmt.shortDate(e.day))").font(Typography.sans(11.5)).foregroundStyle(.white.opacity(0.55))
                        }
                        Spacer()
                        Text((e.kind == .pay ? "+" : "−") + Fmt.money(e.amount))
                            .font(Typography.sans(14)).monospacedDigit()
                            .foregroundStyle(e.kind == .pay ? Color(hex: 0x5FBF86) : .white)
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .top) { if i > 0 { Rule() } }
                }
            }
            Fine(text: today.billCount > 0 ? "Bills before payday are already set aside, so they never show up as spendable." : "Nothing is due before payday.")
        }
    }

    private func end(_ label: String, _ date: String, _ alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 3) {
            Text(label.uppercased())
            Text(date.uppercased())
        }
        .font(Typography.mono(10, weight: 500)).tracking(1.2)
        .foregroundStyle(.white.opacity(0.55))
    }
}

private struct SunPath: View {
    var cycle: Cycle

    var body: some View {
        Canvas { ctx, size in
            let r = min(size.width / 2 - 10, size.height - 12)
            let center = CGPoint(x: size.width / 2, y: size.height - 6)
            func at(_ p: Double) -> CGPoint {
                let a = Double.pi * (1 - p)
                return CGPoint(x: center.x + r * cos(a), y: center.y - r * sin(a))
            }
            func arc(to p: Double) -> Path {
                var path = Path()
                path.addArc(center: center, radius: r, startAngle: .degrees(180), endAngle: .degrees(180 + 180 * p), clockwise: false)
                return path
            }
            var horizon = Path()
            horizon.move(to: CGPoint(x: 6, y: center.y))
            horizon.addLine(to: CGPoint(x: size.width - 6, y: center.y))
            ctx.stroke(horizon, with: .color(.white.opacity(0.16)), lineWidth: 1)
            ctx.stroke(arc(to: 1), with: .color(.white.opacity(0.28)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round, dash: [2, 5]))
            ctx.stroke(arc(to: cycle.today), with: .color(.white.opacity(0.85)), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            for m in cycle.marks {
                let dot = Path(ellipseIn: CGRect(x: at(m.p).x - 4.5, y: at(m.p).y - 4.5, width: 9, height: 9))
                ctx.fill(dot, with: .color(m.kind == .pay ? Palette.pay : Color(hex: 0x15161C)))
                ctx.stroke(dot, with: .color(m.kind == .pay ? Palette.payLine : .white.opacity(0.8)), lineWidth: 1.4)
            }
            let sun = at(cycle.today)
            ctx.fill(Path(ellipseIn: CGRect(x: sun.x - 26, y: sun.y - 26, width: 52, height: 52)),
                     with: .radialGradient(Gradient(stops: [.init(color: Color(hex: 0xFFE7A8), location: 0),
                                                           .init(color: Palette.sun.opacity(0.55), location: 0.35),
                                                           .init(color: Palette.sun.opacity(0), location: 1)]),
                                           center: sun, startRadius: 0, endRadius: 26))
            ctx.fill(Path(ellipseIn: CGRect(x: sun.x - 7, y: sun.y - 7, width: 14, height: 14)), with: .color(Color(hex: 0xFFF3D1)))
        }
    }
}

/// Ten days of safe-to-spend, drawn like an hourly temperature curve.
private struct OutlookCard: View {
    var snapshot: Snapshot

    var body: some View {
        let days = outlook(snapshot, days: 10)
        let vals = days.map { max(0, $0.daily) }
        let low = days.min { max(0, $0.daily) < max(0, $1.daily) } ?? days[0]
        let pay = days.first { $0.payday }
        let title: String = if let pay, max(0, pay.daily) > vals[0] * 1.3 {
            "Clearing on \(pay.day == 1 ? "tomorrow" : Fmt.weekday(pay.day))."
        } else if vals.allSatisfy({ $0 >= snapshot.typicalDay }) {
            "Fair all week."
        } else {
            "Lowest on \(low.day == 0 ? "today" : Fmt.weekday(low.day))."
        }
        Card(eyebrow: "10-day outlook · safe to spend a day", title: title) {
            OutlookChart(days: days, values: vals, typical: snapshot.typicalDay)
                .frame(height: 150)
                .accessibilityLabel(zip(days, vals).map { "\(Fmt.dayName($0.day)) \(Fmt.money($1))" }.joined(separator: ", "))
            HStack(alignment: .top) {
                stat(vals[0], "today", .leading)
                Spacer()
                stat(vals.max() ?? 0, "best day", .center)
                Spacer()
                stat(max(0, low.daily), "lowest", .trailing)
            }
            .padding(.top, 12)
            .overlay(alignment: .top) { Rule() }
        }
    }

    private func stat(_ v: Double, _ label: String, _ alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(Fmt.money(v)).font(Typography.serif(22, weight: 300)).monospacedDigit()
            Text(label).font(Typography.sans(12.5)).foregroundStyle(.white.opacity(0.6))
        }
    }
}

private struct OutlookChart: View {
    var days: [OutlookDay]
    var values: [Double]
    var typical: Double

    var body: some View {
        Canvas { ctx, size in
            let top = 22.0, bottom = 118.0, left = 6.0, right = size.width - 6
            let maxV = max(values.max() ?? 0, typical * 1.25, 1)
            let x = { (i: Int) in left + (right - left) * Double(i) / Double(days.count - 1) }
            let y = { (v: Double) in bottom - (bottom - top) * v / maxV }
            let pts = values.enumerated().map { CGPoint(x: x($0.offset), y: y($0.element)) }
            let label = { (s: String, color: Color) in
                Text(s).font(Typography.mono(8.5, weight: 500)).tracking(1).foregroundStyle(color)
            }

            for (i, d) in days.enumerated() where d.payday {
                var line = Path()
                line.move(to: CGPoint(x: x(i), y: top - 10))
                line.addLine(to: CGPoint(x: x(i), y: bottom))
                ctx.stroke(line, with: .color(Color(hex: 0x8FB4F0, opacity: 0.55)), lineWidth: 1)
                ctx.draw(label("PAY", Color(hex: 0xB9CFF5)), at: CGPoint(x: x(i), y: top - 13), anchor: .bottom)
            }
            var typ = Path()
            typ.move(to: CGPoint(x: left, y: y(typical)))
            typ.addLine(to: CGPoint(x: right, y: y(typical)))
            ctx.stroke(typ, with: .color(.white.opacity(0.35)), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
            ctx.draw(label("TYPICAL DAY \(Fmt.money(typical))", .white.opacity(0.55)), at: CGPoint(x: right, y: y(typical) - 6), anchor: .bottomTrailing)

            let line = smooth(pts)
            var area = line
            area.addLine(to: CGPoint(x: right, y: bottom))
            area.addLine(to: CGPoint(x: left, y: bottom))
            area.closeSubpath()
            ctx.fill(area, with: .linearGradient(Gradient(colors: [.white.opacity(0.22), .white.opacity(0)]),
                                                 startPoint: CGPoint(x: 0, y: top), endPoint: CGPoint(x: 0, y: bottom)))
            ctx.stroke(line, with: .color(.white), style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
            let now = pts[0]
            ctx.fill(Path(ellipseIn: CGRect(x: now.x - 7.5, y: now.y - 7.5, width: 15, height: 15)), with: .color(Palette.sun.opacity(0.45)))
            ctx.fill(Path(ellipseIn: CGRect(x: now.x - 4.5, y: now.y - 4.5, width: 9, height: 9)), with: .color(Color(hex: 0xFFF3D1)))

            for (i, d) in days.enumerated() where i == 0 || i % 2 == 0 || d.payday {
                let text = i == 0 ? "NOW" : String(Fmt.dayName(d.day).prefix(3)).uppercased()
                let anchor: UnitPoint = i == 0 ? .bottomLeading : i == days.count - 1 ? .bottomTrailing : .bottom
                ctx.draw(Text(text).font(Typography.mono(9, weight: 500)).tracking(0.9).foregroundStyle(i == 0 ? .white : .white.opacity(0.55)),
                         at: CGPoint(x: x(i), y: size.height - 2), anchor: anchor)
            }
        }
    }

    /// A smooth curve through the points that never overshoots (monotone cubic), as on the web.
    private func smooth(_ p: [CGPoint]) -> Path {
        var path = Path()
        guard let first = p.first else { return path }
        path.move(to: first)
        let n = p.count
        let d = (0..<(n - 1)).map { (p[$0 + 1].y - p[$0].y) / (p[$0 + 1].x - p[$0].x) }
        let m = (0..<n).map { i in i == 0 ? d[0] : i == n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2 }
        for i in 0..<(n - 1) {
            let h = (p[i + 1].x - p[i].x) / 3
            path.addCurve(to: p[i + 1], control1: CGPoint(x: p[i].x + h, y: p[i].y + m[i] * h),
                          control2: CGPoint(x: p[i + 1].x - h, y: p[i + 1].y - m[i + 1] * h))
        }
        return path
    }
}

/// Where this morning's cash goes, as one bar split into its parts.
private struct MathCard: View {
    var snapshot: Snapshot
    var today: Today

    private static let colors: [Split.Key: Color] = [
        .bills: .white.opacity(0.88), .savings: Color(hex: 0x8FB4F0), .cushion: .white.opacity(0.34),
        .later: .white.opacity(0.14), .today: Palette.sun,
    ]

    var body: some View {
        let parts = splitToday(snapshot, today)
        let total = max(today.startCash, parts.reduce(0) { $0 + $1.amount }, 1)
        Card(eyebrow: "The math", title: "How today's number is made.") {
            Para(text: "\(Fmt.money(today.startCash)) in checking this morning, split \(today.pool < 0 ? "and it doesn't cover everything" : "before anything counts as spendable").")
            GeometryReader { geo in
                let gaps = CGFloat(parts.filter { $0.amount > 0 }.count - 1) * 3
                HStack(spacing: 3) {
                    ForEach(parts.filter { $0.amount > 0 }, id: \.key) { p in
                        RoundedRectangle(cornerRadius: 4).fill(Self.colors[p.key]!)
                            .frame(width: max(3, (geo.size.width - gaps) * p.amount / total))
                    }
                }
                .overlay(alignment: .leading) {
                    if today.pool < 0 {
                        RoundedRectangle(cornerRadius: 1).fill(Color(hex: 0xFF9A85)).frame(width: 2, height: 24)
                            .offset(x: geo.size.width * today.startCash / total - 1)
                    }
                }
            }
            .frame(height: 14)
            .accessibilityElement()
            .accessibilityLabel(parts.map { "\($0.label) \(Fmt.money($0.amount))" }.joined(separator: ", "))
            VStack(spacing: 0) {
                ForEach(Array(parts.enumerated()), id: \.offset) { i, p in
                    HStack {
                        RoundedRectangle(cornerRadius: 3).fill(Self.colors[p.key]!).frame(width: 9, height: 9).padding(.trailing, 4)
                        Text(p.label).foregroundStyle(.white.opacity(0.62))
                        Spacer()
                        Text(Fmt.money(p.amount)).monospacedDigit()
                    }
                    .font(Typography.sans(14))
                    .padding(.vertical, 11)
                    .overlay(alignment: .top) { if i > 0 { Rule() } }
                }
            }
            HStack(alignment: .firstTextBaseline) {
                Eyebrow(text: "Safe to spend today", color: .white.opacity(0.62))
                Spacer()
                Text(Fmt.money(today.safeToSpend)).font(Typography.serif(34, weight: 300)).monospacedDigit()
            }
            .padding(.top, 14)
            .overlay(alignment: .top) { Rule(opacity: 0.18) }
            if snapshot.spentToday > 0 {
                Fine(text: "\(Fmt.money(max(0, today.daily))) for today, less the \(Fmt.money(snapshot.spentToday)) you've already spent.")
            }
        }
    }
}

/// Savings buckets as rings, filled toward each goal.
private struct SavingsCard: View {
    var buckets: [Bucket]

    var body: some View {
        let per = buckets.reduce(0) { $0 + $1.perPaycheck }
        let saved = buckets.reduce(0) { $0 + $1.saved }
        Card(eyebrow: "Savings · \(Fmt.money(saved)) put away", title: "Pay yourself first.") {
            Para(text: "\(Fmt.money(per)) leaves every paycheck before anything looks spendable.")
            HStack(alignment: .top, spacing: 10) {
                ForEach(Array(buckets.prefix(3).enumerated()), id: \.offset) { i, b in
                    let p = b.goal > 0 ? min(1, b.saved / b.goal) : 0
                    VStack(spacing: 10) {
                        ZStack {
                            Circle().stroke(.white.opacity(0.1), lineWidth: 5)
                            Circle().trim(from: 0, to: p)
                                .stroke(Palette.buckets[i % Palette.buckets.count], style: StrokeStyle(lineWidth: 5, lineCap: .round))
                                .rotationEffect(.degrees(-90))
                            Text("\(Int((p * 100).rounded()))%").font(Typography.serif(19, weight: 300))
                        }
                        .frame(width: 80, height: 80)
                        VStack(spacing: 2) {
                            Text(b.name).font(Typography.sans(13)).lineLimit(1)
                            Text("\(Fmt.money(b.saved)) of \(Fmt.money(b.goal))").font(Typography.sans(11.5)).foregroundStyle(.white.opacity(0.55))
                                .lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// Last week's pace on a half-dial: the needle is the pace, the gold tick today's safe pace.
private struct PaceTile: View {
    var snapshot: Snapshot
    var safe: Double

    var body: some View {
        let pace = snapshot.recentPace
        let over = pace > safe
        Card(eyebrow: "Spending pace", spacing: 10) {
            Canvas { ctx, size in
                let s = min(size.width / 100, size.height / 60)
                ctx.translateBy(x: (size.width - 100 * s) / 2, y: 0)
                ctx.scaleBy(x: s, y: s)
                let scale = max(pace, safe, 1) * 1.3
                func pt(_ v: Double, _ r: Double) -> CGPoint {
                    let a = Double.pi * (1 - min(1, v / scale))
                    return CGPoint(x: 50 + r * cos(a), y: 54 - r * sin(a))
                }
                var track = Path()
                track.addArc(center: CGPoint(x: 50, y: 54), radius: 42, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
                ctx.stroke(track, with: .color(.white.opacity(0.16)), style: StrokeStyle(lineWidth: 5, lineCap: .round))
                var tick = Path()
                tick.move(to: pt(safe, 36)); tick.addLine(to: pt(safe, 48))
                ctx.stroke(tick, with: .color(Palette.sun), style: StrokeStyle(lineWidth: 2.2, lineCap: .round))
                var needle = Path()
                needle.move(to: CGPoint(x: 50, y: 54)); needle.addLine(to: pt(pace, 34))
                ctx.stroke(needle, with: .color(over ? Color(hex: 0xFFB2A3) : .white), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
                ctx.fill(Path(ellipseIn: CGRect(x: 47, y: 51, width: 6, height: 6)), with: .color(.white))
            }
            .frame(height: 64)
            (Text(Fmt.money(pace)).font(Typography.serif(34, weight: 300)) + Text(" /day").font(Typography.sans(13)).foregroundColor(.white.opacity(0.6)))
                .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            Fine(text: "Last 7 days, \(over ? "above" : "under") today's safe pace of \(Fmt.money(safe)).")
        }
    }
}

/// The cushion, under an umbrella: it's what keeps a surprise charge off you.
private struct CushionTile: View {
    var cushion: Double

    var body: some View {
        Card(eyebrow: "Cushion", spacing: 10) {
            Canvas { ctx, size in
                let s = min(size.width / 100, size.height / 60)
                ctx.translateBy(x: (size.width - 100 * s) / 2, y: 0)
                ctx.scaleBy(x: s, y: s)
                var canopy = Path()
                canopy.move(to: CGPoint(x: 18, y: 34))
                canopy.addQuadCurve(to: CGPoint(x: 82, y: 34), control: CGPoint(x: 50, y: -2))
                for (end, control) in [(66.0, 74.0), (50, 58), (34, 42), (18, 26)] {
                    canopy.addQuadCurve(to: CGPoint(x: end, y: 34), control: CGPoint(x: control, y: 29))
                }
                canopy.closeSubpath()
                ctx.fill(canopy, with: .color(.white.opacity(0.1)))
                ctx.stroke(canopy, with: .color(.white.opacity(0.85)), style: StrokeStyle(lineWidth: 1.4, lineJoin: .round))
                var stem = Path()
                stem.move(to: CGPoint(x: 50, y: 34))
                stem.addLine(to: CGPoint(x: 50, y: 52))
                stem.addQuadCurve(to: CGPoint(x: 45, y: 57), control: CGPoint(x: 50, y: 57))
                stem.addQuadCurve(to: CGPoint(x: 41, y: 53), control: CGPoint(x: 41, y: 57))
                ctx.stroke(stem, with: .color(.white.opacity(0.85)), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
            }
            .frame(height: 64)
            Text(Fmt.money(cushion)).font(Typography.serif(34, weight: 300)).monospacedDigit()
            Fine(text: "Held back so a surprise charge never overdraws you.")
        }
    }
}
