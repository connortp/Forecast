import SwiftUI

@main
struct ForecastApp: App {
    init() { Typography.registerFonts() }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}
