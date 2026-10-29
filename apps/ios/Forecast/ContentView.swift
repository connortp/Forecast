import SwiftUI
import ForecastKit

struct ContentView: View {
    /// Where the number comes from: the signed-in person's bank, or the example scenarios.
    enum Source {
        case example(exit: () -> Void)
        case live(Backend.Loaded, AppSession)
    }

    var source: Source
    @AppStorage("scenario") private var scenario: Scenario = .partly
    @AppStorage("tone") private var tone: Tone = .spicy
    @AppStorage("time") private var timeSetting = "auto"
    @State private var pastHero = false

    private var timeOfDay: TimeOfDay { TimeOfDay(rawValue: timeSetting) ?? .now }

    private var snapshot: Snapshot? {
        switch source {
        case .example: scenario.snapshot
        case .live(let loaded, _): loaded.snapshot
        }
    }

    var body: some View {
        if let s = snapshot {
            forecast(s)
        } else if case .live(_, let session) = source {
            NoPaycheck(session: session)
        }
    }

    private func forecast(_ s: Snapshot) -> some View {
        let t = today(s)

        return ZStack {
            SkyView(condition: t.condition, timeOfDay: timeOfDay, dim: pastHero)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        Hero(amount: t.safeToSpend)
                            .containerRelativeFrame(.vertical)
                        DetailsSheet(snapshot: s, today: t, tone: tone, night: timeOfDay == .night) {
                            switch source {
                            case .example(let exit):
                                DemoControls(scenario: $scenario, tone: $tone, time: $timeSetting, exit: exit)
                            case .live(_, let session):
                                LiveControls(session: session)
                            }
                        }
                        .id("details")
                    }
                }
                #if DEBUG
                // `-openDetails YES` as a launch argument starts scrolled to the cards, for screenshots.
                // Waits a beat: on first appear the scroll view hasn't laid out its content, so scrollTo is a no-op.
                .task {
                    guard UserDefaults.standard.bool(forKey: "openDetails") else { return }
                    try? await Task.sleep(for: .milliseconds(400))
                    proxy.scrollTo("details", anchor: .top)
                }
                #endif
            }
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: .bottom)
            // Cards fade out just below the status bar instead of sliding under the clock, as in Weather.
            .mask {
                VStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 28)
                    Color.black
                }
                .ignoresSafeArea(edges: .bottom)
            }
            // Past the hero the sky softens behind the cards, like the sign-up flow.
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y > $0.containerSize.height * 0.35 } action: { _, past in
                pastHero = past
            }
            .refreshable {
                if case .live(_, let session) = source { await session.refresh() }
            }
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
            Eyebrow(text: "Safe to spend", color: .white.opacity(0.92))
                .padding(.top, 4)
        }
        .shadow(color: Palette.shade.opacity(0.18), radius: 1, y: 1)
        .shadow(color: Palette.shade.opacity(0.32), radius: 15, y: 2)
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
    var exit: () -> Void

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
            Button("Back to sign in", action: exit)
                .font(Typography.mono(11.5, weight: 500)).tracking(1.3).textCase(.uppercase)
                .foregroundStyle(Palette.ink2)
        }
        .padding(.top, 12)
    }
}

/// The bottom of the sheet on real data: refresh, sign out, and a note while Plaid is in sandbox.
private struct LiveControls: View {
    var session: AppSession
    @State private var refreshing = false

    var body: some View {
        VStack(spacing: 12) {
            if Backend.plaidSandbox { Eyebrow(text: "Sandbox bank · test data from Plaid") }
            HStack(spacing: 8) {
                Pill(title: refreshing ? "Refreshing…" : "Refresh from bank") {
                    refreshing = true
                    Task { await session.refresh(); refreshing = false }
                }
                .disabled(refreshing)
                Pill(title: "Sign out") { Task { await session.signOut() } }
            }
            if let error = session.error {
                Text(error).font(Typography.sans(12)).foregroundStyle(Palette.ink2).multilineTextAlignment(.center)
            }
        }
        .padding(.top, 12)
    }
}

/// Signed in and set up, but there's no paycheck to count toward (say, every deposit stopped).
private struct NoPaycheck: View {
    var session: AppSession

    var body: some View {
        VStack(spacing: 16) {
            Text("No paycheck in sight").font(Typography.serif(30, weight: 300))
            Text("Forecast needs a regular deposit to count toward. Pull in your latest transactions, or check back after your next payday.")
                .font(Typography.sans(14)).foregroundStyle(Palette.ink2).multilineTextAlignment(.center)
            HStack(spacing: 8) {
                Pill(title: "Refresh from bank") { Task { await session.refresh() } }
                Pill(title: "Sign out") { Task { await session.signOut() } }
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.sheet)
        .foregroundStyle(Palette.ink)
    }
}

private struct Pill: View {
    var title: String
    var action: () -> Void

    var body: some View {
        Button(title, action: action)
            .font(Typography.sans(13, weight: 500))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .foregroundStyle(Palette.ink2)
            .background(Palette.card, in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.line))
            .buttonStyle(.plain)
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
