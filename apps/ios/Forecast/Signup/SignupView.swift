import SwiftUI
import UserNotifications
import Supabase
import ForecastKit

/// Sign-up, one idea per screen over the sky: account, bank, paydays, bills, savings,
/// the morning notification, then the first number. Mirrors apps/web/src/components/onboarding,
/// on the signed-in person's real Supabase and Plaid data.
struct SignupView: View {
    var session: AppSession
    var showExample: () -> Void

    enum Step: Hashable { case welcome, email, code, bank, reading, payday, bills, savings, notify, reveal }

    @State private var step: Step = .welcome
    @State private var trail: [Step] = []
    @State private var email = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @State private var bank = "your bank"

    // What the person confirms along the way.
    @State private var every = 14
    @State private var payAmount = ""
    @State private var payDate = Calendar.current.date(byAdding: .day, value: 7, to: .now) ?? .now
    @State private var billsOff: Set<String> = []
    @State private var buckets = SignupExample.Choices().buckets
    @State private var cushion: Double = 150
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

    // MARK: Live data

    private var rows: Live.Rows? { session.loaded?.rows }
    private var ymd: String { Live.localYmd() }
    private var found: Live.FoundPaycheck? {
        rows.flatMap { Live.findPaycheck(streams: $0.streams, settings: nil, today: ymd) }
    }
    /// Every regular outflow, including ones the person has turned off here.
    private var bills: [Live.FoundBill] {
        Live.findBills((rows?.streams ?? []).map { var s = $0; s.ignored = false; return s }, today: ymd)
    }

    private var settings: Backend.SettingsUpdate {
        Backend.SettingsUpdate(
            cushion: cushion,
            payAmountOverride: found == nil ? Double(payAmount) : nil,
            nextPaydayOverride: found == nil ? Live.localYmd(now: payDate) : nil,
            payEveryDaysOverride: found.map { $0.every == every } == true ? nil : every)
    }

    /// The rows as the person has confirmed them so far, for the live number.
    private var snapshot: Snapshot? {
        guard var r = rows else { return nil }
        let s = settings
        r.streams = r.streams.map { var x = $0; x.ignored = billsOff.contains(x.id); return x }
        r.buckets = buckets.map { Live.BucketRow(name: $0.name, goal: $0.goal, saved: 0, perPaycheck: $0.perPaycheck) }
        r.settings = Live.Settings(cushion: s.cushion, payAmountOverride: s.payAmountOverride,
                                   nextPaydayOverride: s.nextPaydayOverride, payEveryDaysOverride: s.payEveryDaysOverride)
        return Live.snapshot(r, today: ymd)
    }

    var body: some View {
        ZStack {
            SignupSky(scene: step == .welcome ? .clouds : step == .reveal ? .clear : .dim)

            VStack(spacing: 0) {
                TopBar(stage: stage, canGoBack: !trail.isEmpty && ![.bank, .reading].contains(step), back: back)
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
        .sensoryFeedback(.selection, trigger: step)
        // Signed in by code, by the email's link, or already signed in from before: pick up where they are.
        .onChange(of: session.state, initial: true) { resume() }
        .onChange(of: session.error) { _, e in if let e, step == .code { error = e } }
    }

    @ViewBuilder private var screen: some View {
        switch step {
        case .welcome: welcome
        case .email: emailScreen
        case .code: codeScreen
        case .bank: bankScreen
        case .reading: reading
        case .payday: payday
        case .bills: billsScreen
        case .savings: savings
        case .notify: notify
        case .reveal:
            if let snapshot {
                RevealScreen(today: today(snapshot), cushion: cushion, busy: busy, error: error, finish: finish)
            }
        }
    }

    private func go(_ next: Step) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.4)) {
            error = nil
            trail.append(step)
            step = next
        }
    }

    private func back() {
        guard let prev = trail.popLast() else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.4)) {
            error = nil
            step = prev == .reading ? .bank : prev
        }
    }

    private func resume() {
        guard session.state == .signedIn, let loaded = session.loaded, [.welcome, .email, .code].contains(step) else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.4)) {
            error = nil
            trail = []
            step = loaded.hasBank ? .reading : .bank
        }
    }

    /// Runs a step's network work with the buttons disabled, and shows any error under them.
    private func attempt(_ work: @escaping @MainActor () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do { try await work() } catch { self.error = error.localizedDescription }
            busy = false
        }
    }

    // MARK: Account

    private func sendLink() {
        attempt {
            try await Backend.client.auth.signInWithOTP(email: email.trimmingCharacters(in: .whitespaces), redirectTo: Backend.redirect)
            if step == .email { go(.code) }
        }
    }

    private func verify() {
        attempt {
            do {
                try await Backend.client.auth.verifyOTP(email: email.trimmingCharacters(in: .whitespaces), token: code, type: .email)
            } catch {
                throw Problem("That code didn't work. Check it, or send a new one.")
            }
            // The session's .signedIn moves on to the bank step.
        }
    }

    // MARK: Bank

    private struct LinkToken: Decodable { var linkToken: String }
    private struct SandboxToken: Decodable { var publicToken: String; var institution: AnyJSON }

    private func connect() {
        attempt {
            let token: LinkToken = try await Backend.call("create-link-token")
            guard let linked = try await PlaidLink.open(token: token.linkToken) else { return }
            let _: AnyJSON = try await Backend.call("exchange-public-token", [
                "public_token": .string(linked.publicToken),
                "institution": ["institution_id": .string(linked.institutionId), "name": .string(linked.institutionName)],
            ])
            bank = linked.institutionName
            go(.reading)
        }
    }

    /// Sandbox only: links Plaid's test user without opening Link.
    private func testBank() {
        attempt {
            let sandbox: SandboxToken = try await Backend.call("sandbox-public-token")
            let _: AnyJSON = try await Backend.call("exchange-public-token", ["public_token": .string(sandbox.publicToken), "institution": sandbox.institution])
            bank = "a test bank"
            go(.reading)
        }
    }

    // MARK: Saving

    private func saveAll(skipSavings: Bool = false) {
        if skipSavings { for i in buckets.indices { buckets[i].perPaycheck = 0 } }
        let settings = settings, streams = rows?.streams ?? [], billsOff = billsOff, buckets = buckets
        attempt {
            try await Backend.saveSignup(settings: settings, streams: streams, billsOff: billsOff, buckets: buckets)
            go(.notify)
        }
    }

    private func finish() {
        attempt {
            try await Backend.finishSignup()
            // Root moves on to the forecast once the reload sees onboarded_at.
            await session.reload()
        }
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
            ErrorLine(error: error)
            VStack(spacing: 10) {
                // Sign in with Apple and Google need their providers switched on in Supabase first.
                SignupButton(title: "Continue with Apple", icon: "apple.logo") { error = "Apple sign-in isn't switched on yet. Use email for now." }
                SignupButton(title: "Continue with Google", icon: "g.circle", style: .ghost) { error = "Google sign-in isn't switched on yet. Use email for now." }
                SignupButton(title: "Use email instead", style: .text) { go(.email) }
            }
            Text("Already have an account? The same buttons sign you in.")
                .font(Typography.sans(12)).foregroundStyle(.white.opacity(0.5))
                .frame(maxWidth: .infinity)
            Button("Look around with example data", action: showExample)
                .font(Typography.sans(12)).underline().foregroundStyle(.white.opacity(0.5))
                .frame(maxWidth: .infinity)
        }
    }

    private var emailScreen: some View {
        StepScreen(eyebrow: "Create your account", title: ("What's your ", "email", "?"),
                   lead: "We'll email you a sign-in link. No password to remember.") {
            VStack(alignment: .leading, spacing: 8) {
                Eyebrow(text: "Email", color: .white.opacity(0.6))
                TextField("", text: $email, prompt: Text("you@example.com").foregroundStyle(.white.opacity(0.4)))
                    .textContentType(.emailAddress).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(Typography.sans(16))
                    .padding(16)
                    .glass(radius: 12)
                    .submitLabel(.send)
                    .onSubmit { if email.contains("@") && !busy { sendLink() } }
            }
            ErrorLine(error: error)
        } actions: {
            SignupButton(title: busy ? "Sending…" : "Send link") { sendLink() }.disabled(!email.contains("@") || busy)
        }
    }

    private var codeScreen: some View {
        StepScreen(eyebrow: "Create your account", title: ("Check your ", "inbox", "."),
                   lead: "We sent a sign-in link to \(email). Open it on this iPhone and you'll come right back here. Got a six-digit code instead? Enter it below.") {
            CodeField(code: $code)
            Button("Resend email") { code = ""; sendLink() }
                .font(Typography.mono(12, weight: 500)).tracking(1.4).textCase(.uppercase)
                .foregroundStyle(.white.opacity(0.72))
                .disabled(busy)
            ErrorLine(error: error)
        } actions: {
            SignupButton(title: busy ? "Checking…" : "Verify") { verify() }.disabled(code.count != 6 || busy)
        }
    }

    private var bankScreen: some View {
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
            ErrorLine(error: error)
        } actions: {
            SignupButton(title: busy ? "Connecting…" : "Connect bank") { connect() }.disabled(busy)
            if Backend.plaidSandbox {
                SignupButton(title: "Use a test bank", style: .text) { testBank() }.disabled(busy)
            }
        }
    }

    private var reading: some View {
        let r = rows
        let items: [(String, Bool)] = [
            (r?.accounts.isEmpty == false ? "Balances from \(bank)" : "Balances", r?.accounts.isEmpty == false),
            (r?.transactions.isEmpty == false ? "\(r!.transactions.count.formatted()) transactions" : "Transactions", r?.transactions.isEmpty == false),
            ("Finding your paydays", r?.streams.contains { $0.direction == .inflow } == true),
            ("Finding your bills", r?.streams.contains { $0.direction == .outflow } == true),
        ]
        return ReadingScreen(items: items)
            // Wait for Plaid's history to land (its webhook fills it in), for up to 45 seconds.
            .task {
                let started = Date.now
                while !Task.isCancelled {
                    await session.reload()
                    let r = session.loaded?.rows
                    if (r.map { !$0.transactions.isEmpty && !$0.streams.isEmpty } ?? false) || Date.now.timeIntervalSince(started) > 45 { break }
                    try? await Task.sleep(for: .seconds(2))
                }
                if let p = found { every = p.every }
                try? await Task.sleep(for: reduceMotion ? .milliseconds(200) : .milliseconds(900))
                if !Task.isCancelled { go(.payday) }
            }
    }

    private var payday: some View {
        let cadence = SignupExample.cadences.first { $0.every == every } ?? SignupExample.cadences[1]
        let firstPay = snapshot?.paycheck.nextIn ?? found?.nextIn ?? 7
        return StepScreen(eyebrow: "Your paydays",
                          title: found != nil ? ("Looks like you're paid ", cadence.label, ".") : ("When do you get ", "paid", "?"),
                          lead: found != nil ? nil : "We couldn't spot a paycheck yet. Tell us and we'll learn it as deposits land.") {
            if let found {
                VStack(alignment: .leading, spacing: 14) {
                    Eyebrow(text: found.name, color: .white.opacity(0.6))
                    HStack(alignment: .firstTextBaseline) {
                        Text(Fmt.money(found.amount)).font(Typography.serif(42, weight: 300)).monospacedDigit()
                        Spacer()
                        Text("after tax").font(Typography.sans(13)).foregroundStyle(.white.opacity(0.7))
                    }
                    HStack(spacing: 4) {
                        ForEach(0..<7, id: \.self) { i in
                            let d = firstPay + i * every
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
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(text: "Each paycheck, after tax", color: .white.opacity(0.6))
                    TextField("", text: $payAmount, prompt: Text("$2,000").foregroundStyle(.white.opacity(0.4)))
                        .keyboardType(.decimalPad)
                        .font(Typography.sans(16))
                        .padding(16)
                        .glass(radius: 12)
                        .onChange(of: payAmount) { _, v in
                            let clean = v.filter { $0.isNumber || $0 == "." }
                            if clean != v { payAmount = clean }
                        }
                }
                HStack {
                    Eyebrow(text: "Next payday", color: .white.opacity(0.6))
                    Spacer()
                    DatePicker("Next payday", selection: $payDate,
                               in: (Calendar.current.date(byAdding: .day, value: 1, to: .now) ?? .now)...,
                               displayedComponents: .date)
                        .labelsHidden()
                        .colorScheme(.dark)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .glass(radius: 12)
            }
            Chips(options: SignupExample.cadences.map { ($0.every, $0.chip) }, selection: $every)
            ErrorLine(error: error)
        } actions: {
            SignupButton(title: found != nil ? "That's right" : "Continue") {
                if found == nil && !(Double(payAmount) ?? 0 > 0) { error = "Add your paycheck amount." } else { go(.bills) }
            }
        }
    }

    private var billsScreen: some View {
        let total = snapshot.map { today($0).bills } ?? 0
        return StepScreen(eyebrow: "Your bills",
                          title: bills.isEmpty ? ("No bills ", "yet", ".") : ("These come out ", "regularly", "."),
                          lead: bills.isEmpty ? "We'll add them as they repeat. You can also add one later." : "Turn off anything that isn't a real bill.") {
            if !bills.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(bills.enumerated()), id: \.element.id) { i, b in
                        let on = !billsOff.contains(b.id)
                        if i > 0 { Divider().overlay(.white.opacity(0.1)) }
                        Toggle(isOn: Binding(get: { on }, set: { if $0 { billsOff.remove(b.id) } else { billsOff.insert(b.id) } })) {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(b.name).font(Typography.sans(14.5))
                                    Text(Fmt.shortDate(b.dueIn) + (b.every == 30 ? "" : " · \(Self.repeats(b.every))"))
                                        .font(Typography.sans(12)).foregroundStyle(.white.opacity(0.55))
                                }
                                Spacer()
                                Text(Fmt.cents(b.amount)).font(Typography.sans(14.5)).monospacedDigit()
                            }
                            .opacity(on ? 1 : 0.4)
                            .strikethrough(!on)
                        }
                        .tint(Color(hex: 0x5FBF86))
                        .padding(.vertical, 11)
                    }
                }
                .padding(.horizontal, 14)
                .glass()
            }
            HStack(alignment: .firstTextBaseline) {
                Eyebrow(text: "Held for bills before payday", color: .white.opacity(0.6))
                Spacer()
                Text(Fmt.cents((total * 100).rounded() / 100)).font(Typography.serif(21)).monospacedDigit()
                    .contentTransition(.numericText(value: total))
            }
            .padding(.horizontal, 4)
            .animation(.snappy, value: total)
        } actions: {
            SignupButton(title: "Looks right") { go(.savings) }
        }
    }

    private static func repeats(_ every: Int) -> String {
        switch every {
        case 7: "every week"
        case 14: "every 2 weeks"
        case 15: "twice a month"
        case 365: "every year"
        default: "every \(every) days"
        }
    }

    private var savings: some View {
        let firstPay = snapshot?.paycheck.nextIn ?? found?.nextIn ?? 7
        return StepScreen(eyebrow: "Savings", title: ("Pay yourself ", "first", "."),
                          lead: "Set aside from each paycheck before anything looks spendable. Starts with your \(Fmt.shortDate(firstPay)) paycheck.") {
            VStack(spacing: 0) {
                ForEach(buckets.indices, id: \.self) { i in
                    if i > 0 { Divider().overlay(.white.opacity(0.1)) }
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(buckets[i].name).font(Typography.sans(14.5))
                            Text("Goal \(Fmt.money(buckets[i].goal)) · per paycheck").font(Typography.sans(12)).foregroundStyle(.white.opacity(0.55))
                        }
                        Spacer()
                        Stepper(value: $buckets[i].perPaycheck, in: 0...2000, step: 10) {
                            Text(Fmt.money(buckets[i].perPaycheck)).font(Typography.sans(14.5)).monospacedDigit()
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
                    Text(Fmt.money(cushion)).font(Typography.serif(21)).monospacedDigit()
                }
                Slider(value: $cushion, in: 0...500, step: 25).tint(.white)
                Text("Always kept back, so a surprise charge doesn't turn into an overdraft.")
                    .font(Typography.sans(13)).foregroundStyle(.white.opacity(0.76))
            }
            .padding(16)
            .glass()
            ErrorLine(error: error)
        } actions: {
            SignupButton(title: "Continue") { saveAll() }.disabled(busy)
            SignupButton(title: "Skip savings for now", style: .text) { saveAll(skipSavings: true) }.disabled(busy)
        }
    }

    private var notify: some View {
        let t = snapshot.map(today)
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
                    if let t {
                        Text("\(t.condition.name). \(Fmt.money(t.safeToSpend)) safe to spend today, \(t.until) days to payday.")
                            .font(.system(size: 13))
                    }
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


private struct ErrorLine: View {
    var error: String?
    var body: some View {
        if let error {
            Text(error).font(Typography.sans(13.5)).foregroundStyle(Color(hex: 0xFFB4A6))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

private struct ReadingScreen: View {
    /// Each row's label, and whether it has landed yet.
    var items: [(String, Bool)]

    var body: some View {
        let running = items.firstIndex { !$0.1 }
        VStack(alignment: .leading, spacing: 18) {
            Spacer()
            Eyebrow(text: "Reading your sky", color: .white.opacity(0.66))
            (Text("Looking at your last ") + Text("90 days").font(Typography.serif(34, weight: 300, italic: true)) + Text("."))
                .font(Typography.serif(34, weight: 300))
            VStack(alignment: .leading, spacing: 14) {
                ForEach(items.indices, id: \.self) { i in
                    HStack(spacing: 12) {
                        ZStack {
                            if items[i].1 {
                                Image(systemName: "checkmark.circle.fill").font(.system(size: 17))
                            } else if i == running {
                                ProgressView().controlSize(.small).tint(.white)
                            } else {
                                Circle().stroke(.white.opacity(0.3), lineWidth: 1.5).frame(width: 16, height: 16)
                            }
                        }
                        .frame(width: 20)
                        Text(items[i].0).font(Typography.sans(15))
                            .foregroundStyle(.white.opacity(items[i].1 ? 0.86 : i == running ? 1 : 0.45))
                    }
                    .animation(.easeOut(duration: 0.3), value: items[i].1)
                }
            }
            Text("Usually under 30 seconds.")
                .font(Typography.sans(12)).foregroundStyle(.white.opacity(0.5))
            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct RevealScreen: View {
    var today: Today
    var cushion: Double
    var busy: Bool
    var error: String?
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
        if today.safeToSpend.rounded() == 0 && today.daily > 0 {
            return "You've already spent today's \(Fmt.money(today.daily)) share. It resets tomorrow, and you're paid on \(payday)."
        }
        let cover = today.billCount > 0 ? "cover \(bills) (\(Fmt.money(today.bills))) and " : ""
        return "That's what you can spend today and still \(cover)keep your \(Fmt.money(cushion)) cushion until you're paid on \(payday)."
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
                ErrorLine(error: error)
                SignupButton(title: busy ? "Opening…" : "Open Forecast", action: finish).disabled(busy)
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

private extension View {
    /// The frosted card used across sign-up.
    func glass(radius: CGFloat = 16, line: Double = 0.14) -> some View {
        background(.ultraThinMaterial.opacity(0.6), in: RoundedRectangle(cornerRadius: radius))
            .background(RoundedRectangle(cornerRadius: radius).fill(.white.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(.white.opacity(line)))
    }
}
