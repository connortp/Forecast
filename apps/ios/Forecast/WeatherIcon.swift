import SwiftUI
import ForecastKit

/// Weather glyphs from SF Symbols, in their multicolor rendering.
struct WeatherIcon: View {
    var condition: Condition
    var night = false

    var body: some View {
        Image(systemName: symbol)
            .symbolRenderingMode(.multicolor)
            .accessibilityLabel(condition.name)
    }

    private var symbol: String {
        switch condition {
        case .sunny: night ? "moon.stars.fill" : "sun.max.fill"
        case .partly: night ? "cloud.moon.fill" : "cloud.sun.fill"
        case .cloudy: "cloud.fill"
        case .rain: "cloud.rain.fill"
        case .storm: "cloud.bolt.rain.fill"
        }
    }
}
