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

/// Sign-up until it's finished, then the forecast. Launch with `-signedUp YES` or `NO` to skip or replay it.
private struct Root: View {
    @AppStorage("signedUp") private var signedUp = false

    var body: some View {
        ZStack {
            if signedUp {
                ContentView().transition(.opacity)
            } else {
                SignupView { _ in withAnimation(.easeInOut(duration: 0.6)) { signedUp = true } }
                    .transition(.opacity)
            }
        }
    }
}
