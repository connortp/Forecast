import SwiftUI

@main
struct ForecastApp: App {
    init() { Typography.registerFonts() }

    var body: some Scene {
        WindowGroup {
            Root()
                .preferredColorScheme(.dark)
        }
    }
}

/// Sign-up until the account is set up, then the forecast. Example data is a separate demo
/// mode (the welcome screen's last button, or launch with `-demo YES`), like the web's `/?demo`.
private struct Root: View {
    @State private var session = AppSession()
    @AppStorage("demo") private var demo = false

    var body: some View {
        ZStack {
            if demo {
                ContentView(source: .example(exit: { demo = false })).transition(.opacity)
            } else if session.state == .starting || (session.state == .signedIn && session.loaded == nil && session.error == nil) {
                Palette.sheet.ignoresSafeArea().overlay { ProgressView().tint(.white) }
            } else if session.state == .signedIn, let loaded = session.loaded, loaded.onboarded {
                ContentView(source: .live(loaded, session)).transition(.opacity)
            } else if session.state == .signedIn, session.loaded == nil {
                Offline(message: session.error ?? "") { Task { await session.reload() } }
            } else {
                SignupView(session: session, showExample: { withAnimation(.easeInOut(duration: 0.6)) { demo = true } })
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.6), value: session.loaded?.onboarded)
        .task { await session.start() }
        .onOpenURL { url in Task { await session.open(url) } }
    }
}

/// Signed in, but the first load failed (usually no connection).
private struct Offline: View {
    var message: String
    var retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("Couldn't reach Forecast").font(Typography.serif(28, weight: 300))
            Text(message).font(Typography.sans(14)).foregroundStyle(Palette.ink2).multilineTextAlignment(.center)
            SignupButton(title: "Try again", style: .ghost, action: retry).frame(maxWidth: 260)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.sheet)
        .foregroundStyle(.white)
    }
}
