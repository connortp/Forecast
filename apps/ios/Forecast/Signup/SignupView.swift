import SwiftUI
import UserNotifications
import ForecastKit

/// Sign-up, one idea per screen over the sky: account, bank, paydays, bills, savings,
/// the morning notification, then the first number. Mirrors apps/web/src/components/onboarding.
/// Runs on SignupExample until Supabase Auth and Plaid Link are connected.
struct SignupView: View {
    var onFinish: (Snapshot) -> Void

    enum Step: Hashable { case welcome, email, code, bank, reading, payday, bills, savings, notify, reveal }

    @State private var step: Step = .welcome
    @State private var trail: [Step] = []
    @State private var email = ""
    @State private var code = ""
    @State private var showBank = false
    @State private var choices = SignupExample.Choices()
    @State private var notifyHour = 7
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Five stages on the progress bar; the welcome and the reveal sit outside it.
    private var stage: Int {
        switch step {
        case .welcome: -1
        case .email, .code: 0
        case .bank, .reading: 1
        case .payday: 2
        case .bills: 3
        case .savings, .notify: 4
        case .reveal: 5
        }
    }

    var body: some View {
        ZStack {
            SignupSky(scene: step == .welcome ? .clouds : step == .reveal ? .clear : .dim)

            VStack(spacing: 0) {
                TopBar(stage: stage, canGoBack: !trail.isEmpty && step != .reading, back: back)
                    .opacity((0..<5).contains(stage) ? 1 : 0)
                    .allowsHitTesting((0..<5).contains(stage))
                screen
                    .id(step)
                    .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 8)), removal: .opacity))
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 8)
        }
        .foregroundStyle(.white)
        .sheet(isPresented: $showBank) {
            BankSheet { showBank = false; go(.reading) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sensoryFeedback(.selection, trigger: step)
    }

    @ViewBuilder private var screen: some View {
        switch step {
        case .welcome: welcome
        case .email: emailScreen
        case .code: codeScreen
        case .bank: bank
        case .reading: ReadingScreen { go(.payday) }
        case .payday: payday
        case .bills: bills
        case .savings: savings
        case .notify: notify
        case .reveal:
            RevealScreen(today: today(SignupExample.snapshot(choices)), cushion: choices.cushion) {
                onFinish(SignupExample.snapshot(choices))
            }
        }
    }

    private func go(_ next: Step) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.4)) {
            trail.append(step)
            step = next
        }
    }

    private func back() {
        guard let prev = trail.popLast() else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.4)) { step = prev == .reading ? .bank : prev }
    }

    // MARK: Screens

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 9) {
                Image(systemName: "sun.max").font(.system(size: 20, weight: .light))
                Text("Forecast").font(Typography.serif(23))
            }
            .padding(.top, 8)
            Spacer()
            (Text("One number, ") + Text("every").font(Typography.serif(50, weight: 300, italic: true)) + Text(" morning."))
                .font(Typography.serif(50, weight: 300))
                .lineSpacing(-4)
                .accessibilityAddTraits(.isHeader)
            Text("What you can safely spend today, after bills and savings, until your next paycheck.")
                .font(Typography.sans(15)).foregroundStyle(.white.opacity(0.76))
            VStack(spacing: 10) {
                // Real Sign in with Apple arrives with Supabase Auth; this stands in for it.
                SignupButton(title: "Continue with Apple", icon: "apple.logo") { go(.bank) }
                SignupButton(title: "Continue with Google", icon: "g.circle", style: .ghost) { go(.bank) }
                SignupButton(title: "Use email instead", style: .text) { go(.email) }
            }
            Text("Already have an account? The same buttons sign you in.")
                .font(Typography.sans(12)).foregroundStyle(.white.opacity(0.5))
                .frame(maxWidth: .infinity)
        }
    }

    private var emailScreen: some View {
        StepScreen(eyebrow: "Create your account", title: ("What's your ", "email", "?"),
                   lead: "We'll send a six-digit code. No password to remember.") {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow(text: "Email", color: .white.opacity(0.6))
                TextField("", text: $email, prompt: Text("you@example.com").foregroundStyle(.white.opacity(0.4)))
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(Typography.sans(16))
                    .padding(16)
                    .glass(radius: 12)
                    .submitLabel(.send)
                    .onSubmit { if email.contains("@") { go(.code) } }
            }
        } actions: {
            SignupButton(title: "Send code") { go(.code) }.disabled(!email.contains("@"))
        }
    }

    private var codeScreen: some View {
        StepScreen(eyebrow: "Create your account", title: ("Check your ", "inbox", "."),
                   lead: "We sent a code to \(email). Any six digits work in this preview.") {
            CodeField(code: $code)
            Button("Resend code") { code = "" }
                .font(Typography.mono(12, weight: 500)).tracking(1.4).textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.72))
        } actions: {
            SignupButton(title: "Verify") { go(.bank) }.disabled(code.count != 6)
        }
    }

    private var bank: some View {
        StepScreen(eyebrow: "Connect your bank", title: ("Where does your ", "paycheck", " land?"),
                   lead: "Connect that checking account. Add cards and other banks later.") {
            VStack(spacing: 0) {
                TrustRow(icon: "lock", text: "Read-only. Forecast can see balances and transactions, never move money.")
                Divider().overlay(.white.opacity(0.1))
                TrustRow(icon: "checkmark.circle", text: "You sign in with your bank through Plaid. We never see your bank password.")
                Divider().overlay(.white.opacity(0.1))
                TrustRow(icon: "line.3.horizontal", text: "Disconnect any time in Settings, and your bank data is deleted.")
            }
            .padding(.horizontal, 16)
            .glass()
        } actions: {
            SignupButton(title: "Connect bank") { showBank = true }
        }
    }

    private var payday: some View {
        let cadence = SignupExample.cadences.first { $0.every == choices.every } ?? SignupExample.cadences[1]
        return StepScreen(eyebrow: "Your paydays", title: ("Looks like you're paid ", cadence.label, "."), lead: nil) {
            VStack(alignment: .leading, spacing: 14) {
                Eyebrow(text: SignupExample.employer, color: .white.opacity(0.6))
                HStack(alignment: .firstTextBaseline) {
                    Text(Fmt.money(SignupExample.paycheckAmount)).font(Typography.serif(42, weight: 300)).monospacedDigit()
                    Spacer()
                    Text("after tax").font(Typography.sans(13)).foregroundStyle(.white.opacity(0.7))
                }
                HStack(spacing: 4) {
                    ForEach(0..<7, id: \.self) { i in
                        let d = SignupExample.paycheckNextIn + i * choices.every
                        VStack(spacing: 3) {
                            Text(Fmt.month(d)).font(Typography.mono(9)).tracking(0.8).foregroundStyle(.white.opacity(0.6))
                            Text(Fmt.dayOfMonth(d)).font(Typography.sans(12.5)).monospacedDigit()
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 10).fill(i == 0 ? Color(hex: 0x5B8FD6, opacity: 0.6) : .white.opacity(0.06)))
                    }
                }
            }
            .padding(16)
            .glass()
            Chips(options: SignupExample.cadences.map { ($0.every, $0.chip) }, selection: $choices.every)
        } actions: {
            SignupButton(title: "That's right") { go(.bills) }
        }
    }

    private var bills: some View {
        let total = zip(SignupExample.bills, choices.billsOn).filter { $0.1 }.reduce(0) { $0 + $1.0.amount }
        return StepScreen(eyebrow: "Your bills", title: ("These come out ", "before", " payday."),
                          lead: "Turn off anything that isn't a real bill.") {
            VStack(spacing: 0) {
                ForEach(Array(SignupExample.bills.enumerated()), id: \.offset) { i, b in
                    if i > 0 { Divider().overlay(.white.opacity(0.1)) }
                    Toggle(isOn: $choices.billsOn[i]) {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(b.name).font(Typography.sans(14.5))
                                Text([Fmt.shortDate(b.dueIn), b.payee].compactMap { $0 }.joined(separator: " · "))
                                    .font(Typography.sans(12)).foregroundStyle(.white.opacity(0.55))
                            }
                            Spacer()
                            Text(Fmt.cents(b.amount)).font(Typography.sans(14.5)).monospacedDigit()
                        }
                        .opacity(choices.billsOn[i] ? 1 : 0.4)
                        .strikethrough(!choices.billsOn[i])
                    }
                    .tint(Color(hex: 0x5FBF86))
                    .padding(.vertical, 11)
                }
            }
            .padding(.horizontal, 14)
            .glass()
            HStack(alignment: .firstTextBaseline) {
                Eyebrow(text: "Held for bills", color: .white.opacity(0.6))
                Spacer()
                Text(Fmt.cents(total)).font(Typography.serif(21)).monospacedDigit().contentTransition(.numericText(value: total))
            }
            .padding(.horizontal, 4)
            .animation(.snappy, value: total)
        } actions: {
            SignupButton(title: "Looks right") { go(.savings) }
        }
    }

    private var savings: some View {
        StepScreen(eyebrow: "Savings", title: ("Pay yourself ", "first", "."),
                   lead: "Set aside from each paycheck before anything looks spendable. Starts with your \(Fmt.shortDate(SignupExample.paycheckNextIn)) paycheck.") {
            VStack(spacing: 0) {
                ForEach(choices.buckets.indices, id: \.self) { i in
                    if i > 0 { Divider().overlay(.white.opacity(0.1)) }
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(choices.buckets[i].name).font(Typography.sans(14.5))
                            Text("Goal \(Fmt.money(choices.buckets[i].goal)) · per paycheck").font(Typography.sans(12)).foregroundStyle(.white.opacity(0.55))
                        }
                        Spacer()
                        Stepper(value: $choices.buckets[i].perPaycheck, in: 0...2000, step: 10) {
                            Text(Fmt.money(choices.buckets[i].perPaycheck)).font(Typography.sans(14.5)).monospacedDigit()
                        }
                        .fixedSize()
                    }
                    .padding(.vertical, 12)
                }
            }
            .padding(.horizontal, 14)
            .glass()
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Eyebrow(text: "Cushion", color: .white.opacity(0.6))
                    Spacer()
                    Text(Fmt.money(choices.cushion)).font(Typography.serif(21)).monospacedDigit()
                }
                Slider(value: $choices.cushion, in: 0...500, step: 25).tint(.white)
                Text("Always kept back, so a surprise charge doesn't turn into an overdraft.")
                    .font(Typography.sans(13)).foregroundStyle(.white.opacity(0.76))
            }
            .padding(16)
            .glass()
        } actions: {
            SignupButton(title: "Continue") { go(.notify) }
            SignupButton(title: "Skip savings for now", style: .text) {
                for i in choices.buckets.indices { choices.buckets[i].perPaycheck = 0 }
                go(.notify)
            }
        }
    }

    private var notify: some View {
        let t = today(SignupExample.snapshot(choices))
        return StepScreen(eyebrow: "Morning forecast", title: ("Want it ", "before", " you leave the house?"),
                          lead: "One notification a day, plus a heads-up the day before a big bill.") {
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 9).fill(Palette.sheet).frame(width: 34, height: 34)
                    .overlay(Image(systemName: "sun.max").font(.system(size: 17, weight: .light)).foregroundStyle(.white))
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("Forecast").font(.system(size: 13, weight: .semibold))
                        Spacer()
                        Text("\(notifyHour):00 AM").font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    Text("\(t.condition.name). \(Fmt.money(t.safeToSpend)) safe to spend today, \(t.until) days to payday.")
                        .font(.system(size: 13))
                }
            }
            .foregroundStyle(.black)
            .padding(12)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
            .environment(\.colorScheme, .light)
            Chips(options: [6, 7, 8, 9].map { ($0, "\($0):00") }, selection: $notifyHour)
        } actions: {
            SignupButton(title: "Turn on") {
                UserDefaults.standard.set(notifyHour, forKey: "morningHour")
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
                go(.reveal)
            }
            SignupButton(title: "Not now", style: .text) { go(.reveal) }
        }
    }
}

// MARK: - Pieces

/// The sky behind sign-up: the clouds loop on the welcome, a blurred dawn plate behind the steps,
/// and a sharp, clearing sky for the first number.
private struct SignupSky: View {
    enum SkyScene { case clouds, dim, clear }
    var scene: SkyScene
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color(hex: 0x0A0A0B)
                layer("clouds-poster").opacity(scene == .clouds ? 1 : 0)
                if scene == .clouds, !reduceMotion, let video = Self.url("clouds.mp4") {
                    LoopingVideo(url: video).transition(.opacity)
                }
                layer("dawn")
                    .blur(radius: 22).brightness(-0.25).saturation(0.9).scaleEffect(1.12)
                    .opacity(scene == .dim ? 1 : 0)
                layer("partly").opacity(scene == .clear ? 1 : 0)
                LinearGradient(colors: [Color(hex: 0x080A16, opacity: 0.35), Color(hex: 0x080A16, opacity: 0.1), Color(hex: 0x080A16, opacity: 0.55)],
                               startPoint: .top, endPoint: .bottom)
                    .opacity(scene == .clear ? 0.6 : 1)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 1.4), value: scene)
    }

    @ViewBuilder private func layer(_ name: String) -> some View {
        if let url = Self.url("\(name).jpg"), let image = UIImage(contentsOfFile: url.path) {
            Image(uiImage: image).resizable().scaledToFill()
        }
    }

    static func url(_ file: String) -> URL? {
        Bundle.main.resourceURL?.appending(path: "sky").appending(path: file)
    }
}

private struct TopBar: View {
    var stage: Int
    var canGoBack: Bool
    var back: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: back) {
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(.white.opacity(0.1)))
            }
            .opacity(canGoBack ? 1 : 0)
            .disabled(!canGoBack)
            .accessibilityLabel("Back")
            HStack(spacing: 4) {
                ForEach(0..<5, id: \.self) { i in
                    Capsule().fill(.white.opacity(i <= stage ? 1 : 0.18)).frame(height: 3)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("Step \(max(1, stage + 1)) of 5")
            Color.clear.frame(width: 34, height: 34)
        }
        .padding(.top, 8)
        .animation(.easeOut(duration: 0.3), value: stage)
    }
}

/// Eyebrow, a serif title with one italic word, an optional lead, the content, then the buttons at the bottom.
private struct StepScreen<Content: View, Actions: View>: View {
    var eyebrow: String
    var title: (String, String, String)
    var lead: String?
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Eyebrow(text: eyebrow, color: .white.opacity(0.66))
                    (Text(title.0) + Text(title.1).font(Typography.serif(34, weight: 300, italic: true)) + Text(title.2))
                        .font(Typography.serif(34, weight: 300))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let lead {
                        Text(lead).font(Typography.sans(15)).foregroundStyle(.white.opacity(0.76))
                    }
                    content
                }
                .padding(.top, 30)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            VStack(spacing: 10) { actions }.padding(.top, 12)
        }
    }
}

struct SignupButton: View {
    enum Style { case primary, ghost, text }
    var title: String
    var icon: String? = nil
    var style: Style = .primary
    var action: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon { Image(systemName: icon).font(.system(size: 15)) }
                Text(title.uppercased()).font(Typography.mono(12, weight: 500)).tracking(1.4)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, style == .text ? 10 : 18)
            .foregroundStyle(style == .primary ? Palette.sheet : .white.opacity(style == .text ? 0.72 : 1))
            .background {
                switch style {
                case .primary: RoundedRectangle(cornerRadius: 12).fill(.white)
                case .ghost: RoundedRectangle(cornerRadius: 12).fill(.white.opacity(0.1))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.white.opacity(0.18)))
                case .text: Color.clear
                }
            }
            .opacity(enabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
    }
}

private struct TrustRow: View {
    var icon: String
    var text: String
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 15, weight: .light)).frame(width: 22)
            Text(text).font(Typography.sans(14)).foregroundStyle(.white.opacity(0.86))
            Spacer(minLength: 0)
        }
        .padding(.vertical, 14)
    }
}

private struct Chips<Value: Hashable>: View {
    var options: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 6) {
            ForEach(options, id: \.0) { value, label in
                Button { selection = value } label: {
                    Text(label).font(Typography.sans(13))
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .foregroundStyle(selection == value ? Palette.sheet : .white)
                        .background(Capsule().fill(selection == value ? .white : .white.opacity(0.06)))
                        .overlay(Capsule().stroke(.white.opacity(selection == value ? 0 : 0.2)))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == value ? .isSelected : [])
            }
        }
    }
}

/// Six boxes over one hidden field, so the system can fill the code from Messages or Mail.
private struct CodeField: View {
    @Binding var code: String
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focused)
                .opacity(0.02)
                .onChange(of: code) { _, v in
                    let digits = String(v.filter(\.isNumber).prefix(6))
                    if digits != v { code = digits }
                }
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { i in
                    let chars = Array(code)
                    Text(i < chars.count ? String(chars[i]) : "")
                        .font(Typography.serif(28, weight: 300))
                        .frame(maxWidth: .infinity)
                        .aspectRatio(4 / 5, contentMode: .fit)
                        .glass(radius: 12, line: focused && i == code.count ? 0.6 : 0.18)
                }
            }
            .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .onAppear { focused = true }
        .accessibilityElement()
        .accessibilityLabel("Six-digit code, \(code.count) of 6 entered")
    }
}

private struct ReadingScreen: View {
    var done: () -> Void
    @State private var index = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let rows = ["Balances from \(SignupExample.bank)",
                        "\(SignupExample.transactions.formatted()) transactions",
                        "Finding your paydays", "Finding your bills"]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            Eyebrow(text: "Reading your sky", color: .white.opacity(0.66))
            (Text("Looking at your last ") + Text("90 days").font(Typography.serif(34, weight: 300, italic: true)) + Text("."))
                .font(Typography.serif(34, weight: 300))
            VStack(alignment: .leading, spacing: 14) {
                ForEach(rows.indices, id: \.self) { i in
                    HStack(spacing: 12) {
                        ZStack {
                            if i < index {
                                Image(systemName: "checkmark.circle.fill").font(.system(size: 17))
                            } else if i == index {
                                ProgressView().controlSize(.small).tint(.white)
                            } else {
                                Circle().stroke(.white.opacity(0.3), lineWidth: 1.5).frame(width: 16, height: 16)
                            }
                        }
                        .frame(width: 20)
                        Text(rows[i]).font(Typography.sans(15))
                            .foregroundStyle(.white.opacity(i < index ? 0.86 : i == index ? 1 : 0.45))
                    }
                }
            }
            Text("Usually under 30 seconds. You can close the app; we'll let you know when it's ready.")
                .font(Typography.sans(12)).foregroundStyle(.white.opacity(0.5))
            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task {
            let step: Duration = reduceMotion ? .milliseconds(350) : .milliseconds(750)
            for i in 1...rows.count {
                try? await Task.sleep(for: step)
                withAnimation(.easeOut(duration: 0.3)) { index = i }
            }
            try? await Task.sleep(for: step)
            if !Task.isCancelled { done() }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct RevealScreen: View {
    var today: Today
    var cushion: Double
    var finish: () -> Void
    @State private var shown: Double = 0
    @State private var explain = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var line: String {
        let bills = today.billCount == 1 ? "one bill" : "\(today.billCount) bills"
        let payday = Fmt.shortDate(today.until)
        if today.pool < 0 {
            return "You're \(Fmt.money(-today.pool)) short of covering \(bills) before you're paid on \(payday), so today stays at $0."
        }
        return "That's what you can spend today and still cover \(bills) (\(Fmt.money(today.bills))) and keep your \(Fmt.money(cushion)) cushion until you're paid on \(payday)."
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 6) {
                Eyebrow(text: Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()), color: .white.opacity(0.88))
                HStack(alignment: .top, spacing: 2) {
                    Text("$").font(Typography.serif(52, weight: 300)).opacity(0.75).padding(.top, 22)
                    Text(Fmt.whole(shown))
                        .font(Typography.serif(148, weight: 300))
                        .tracking(-4)
                        .contentTransition(.numericText(value: shown))
                }
                .lineLimit(1).minimumScaleFactor(0.5)
                Eyebrow(text: "Safe to spend", color: .white.opacity(0.88)).padding(.top, 4)
            }
            .shadow(color: .black.opacity(0.2), radius: 20, y: 2)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Safe to spend today, \(Fmt.money(today.safeToSpend))")
            Spacer()
            VStack(alignment: .leading, spacing: 12) {
                Eyebrow(text: "Your first forecast", color: .white.opacity(0.62))
                Text(line).font(Typography.serif(18)).foregroundStyle(.white.opacity(0.92))
                    .fixedSize(horizontal: false, vertical: true)
                SignupButton(title: "Open Forecast", action: finish)
            }
            .padding(16)
            .glass()
            .opacity(explain ? 1 : 0)
            .offset(y: explain ? 0 : 10)
        }
        .task {
            if reduceMotion {
                shown = today.safeToSpend.rounded()
                explain = true
                return
            }
            try? await Task.sleep(for: .milliseconds(500))
            withAnimation(.easeOut(duration: 1.3)) { shown = today.safeToSpend.rounded() }
            try? await Task.sleep(for: .milliseconds(1700))
            withAnimation(.easeOut(duration: 0.8)) { explain = true }
        }
        .sensoryFeedback(.success, trigger: explain)
    }
}

/// Stands in for Plaid Link until it's connected: pick a bank, then the accounts Forecast may see.
private struct BankSheet: View {
    var done: () -> Void
    @State private var picked: String?
    @State private var selected = SignupExample.accounts.map(\.selected)

    private let banks: [(String, UInt32)] = [("Harbor Federal", 0x1F4E79), ("Northline Bank", 0x2E6B4F), ("Summit Credit Union", 0x7A3B2E), ("First Meridian", 0x4B3F72)]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text((picked ?? "Bank connection · preview").uppercased())
                .font(Typography.mono(10.5, weight: 500)).tracking(1.3).foregroundStyle(.secondary)
            if picked == nil {
                Text("Select your bank").font(.system(size: 19, weight: .medium))
                Text("Plaid's bank search opens here")
                    .font(.system(size: 14)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemFill)))
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(banks, id: \.0) { name, color in
                        Button { withAnimation { picked = name } } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                RoundedRectangle(cornerRadius: 8).fill(Color(hex: color)).frame(width: 28, height: 28)
                                    .overlay(Text(String(name.prefix(1))).font(Typography.serif(13)).foregroundStyle(.white))
                                Text(name).font(.system(size: 13.5)).multilineTextAlignment(.leading)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemBackground)))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(.separator)))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("Sign-in happens on your bank's own screen.").font(.system(size: 11.5)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            } else {
                Text("Which accounts should Forecast see?").font(.system(size: 19, weight: .medium))
                ForEach(SignupExample.accounts.indices, id: \.self) { i in
                    let a = SignupExample.accounts[i]
                    Toggle(isOn: $selected[i]) {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(a.name).font(.system(size: 14))
                                Text("•••• \(a.mask)\(a.note.map { " · \($0)" } ?? "")").font(.system(size: 12)).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(Fmt.money(a.balance)).font(.system(size: 14)).monospacedDigit()
                        }
                    }
                    .toggleStyle(CheckboxStyle())
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color(.systemBackground)))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(.separator)))
                }
                Button(action: done) {
                    Text("CONTINUE").font(Typography.mono(12, weight: 500)).tracking(1.4)
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .foregroundStyle(.white).background(RoundedRectangle(cornerRadius: 12).fill(Color(hex: 0x111111)))
                }
                .buttonStyle(.plain)
                Text("Read-only access. You can change this later.").font(.system(size: 11.5)).foregroundStyle(.secondary).frame(maxWidth: .infinity)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .padding(.top, 8)
        .foregroundStyle(Color(hex: 0x111111))
        .background(Color(hex: 0xF6F6F4))
        .environment(\.colorScheme, .light)
    }
}

private struct CheckboxStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 10) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square").font(.system(size: 17))
                configuration.label
            }
        }
        .buttonStyle(.plain)
    }
}

private extension View {
    /// The frosted card used across sign-up.
    func glass(radius: CGFloat = 16, line: Double = 0.14) -> some View {
        background(.ultraThinMaterial.opacity(0.6), in: RoundedRectangle(cornerRadius: radius))
            .background(RoundedRectangle(cornerRadius: radius).fill(.white.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(.white.opacity(line)))
    }
}
