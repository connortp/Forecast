import SwiftUI
import ForecastKit

struct ContentView: View {
    @AppStorage("scenario") private var scenario: Scenario = .partly
    @AppStorage("tone") private var tone: Tone = .spicy
    @AppStorage("time") private var timeSetting = "auto"

    private var timeOfDay: TimeOfDay { TimeOfDay(rawValue: timeSetting) ?? .now }

    var body: some View {
        let s = scenario.snapshot
        let t = today(s)

        ZStack {
            SkyView(condition: t.condition, timeOfDay: timeOfDay)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        Hero(amount: t.safeToSpend)
                            .containerRelativeFrame(.vertical)
                        DetailsSheet(snapshot: s, today: t, tone: tone, night: timeOfDay == .night) {
                            DemoControls(scenario: $scenario, tone: $tone, time: $timeSetting)
                        }
                        .id("details")
                    }
                }
                #if DEBUG
                // `-openDetails YES` as a launch argument starts scrolled to the cards, for screenshots.
                .onAppear { if UserDefaults.standard.bool(forKey: "openDetails") { proxy.scrollTo("details", anchor: .top) } }
                #endif
            }
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: .bottom)
        }
        .sensoryFeedback(.selection, trigger: scenario)
    }
}

/// The first screen: the date, the number, and nothing else. The sky says the rest.
private struct Hero: View {
    var amount: Double

    var body: some View {
        VStack(spacing: 6) {
            Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()))
                .font(Typography.serif(21, italic: true))
                .foregroundStyle(.white.opacity(0.9))
            HStack(alignment: .top, spacing: 2) {
                Text("$")
                    .font(Typography.serif(52, weight: 300))
                    .opacity(0.75)
                    .padding(.top, 22)
                Text(Fmt.whole(amount))
                    .font(Typography.serif(148, weight: 300))
                    .tracking(-4)
                    .contentTransition(.numericText(value: amount))
            }
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            Eyebrow(text: "Safe to spend", color: .white.opacity(0.8))
                .padding(.top, 4)
        }
        .shadow(color: .black.opacity(0.16), radius: 20, y: 2)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .bottom) { ScrollHint() }
        .scrollTransition(axis: .vertical) { view, phase in
            view
                .opacity(phase == .bottomTrailing ? 1 : 1 - abs(phase.value) * 0.9)
                .blur(radius: phase == .topLeading ? abs(phase.value) * 12 : 0)
                .scaleEffect(phase == .topLeading ? 1 - abs(phase.value) * 0.06 : 1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Safe to spend today, \(Fmt.money(amount))")
        .animation(.snappy, value: amount)
    }
}

private struct ScrollHint: View {
    @State private var bob = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 18, weight: .light))
            .foregroundStyle(.white.opacity(0.75))
            .offset(y: bob ? 5 : 0)
            .padding(.bottom, 28)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.2).repeatForever()) { bob = true }
            }
            .accessibilityHidden(true)
    }
}

/// The example-data switches at the bottom of the sheet, as on the web prototype.
private struct DemoControls: View {
    @Binding var scenario: Scenario
    @Binding var tone: Tone
    @Binding var time: String

    var body: some View {
        VStack(spacing: 12) {
            Eyebrow(text: "Example data · try other conditions")
            Chips(options: Scenario.allCases.map { ($0, $0.label) }, selection: $scenario)
            Chips(options: [("auto", "Now")] + TimeOfDay.allCases.map { ($0.rawValue, $0.rawValue.capitalized) }, selection: $time)
            Chips(options: [(Tone.calm, "Calm voice"), (Tone.spicy, "Spicy voice")], selection: $tone)
            Text("Prototype with example transactions. Nothing here is real account data.")
                .font(Typography.sans(12))
                .foregroundStyle(Palette.ink3)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
        }
        .padding(.top, 12)
    }
}

private struct Chips<Value: Hashable>: View {
    var options: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.0) { value, label in
                let on = value == selection
                Button(label) { withAnimation(.snappy) { selection = value } }
                    .font(Typography.sans(13, weight: 500))
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .foregroundStyle(on ? Color(hex: 0x111722) : Palette.ink2)
                    .background(on ? Palette.ink : Palette.card, in: Capsule())
                    .overlay(Capsule().strokeBorder(on ? .clear : Palette.line))
                    .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .buttonStyle(.plain)
    }
}
