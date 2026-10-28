// Words for each condition, mirroring apps/web/src/lib/copy.ts.

public enum Tone: String, CaseIterable, Sendable {
    case calm, spicy
}

public extension Condition {
    var name: String {
        switch self {
        case .sunny: "Clear skies"
        case .partly: "Partly cloudy"
        case .cloudy: "Overcast"
        case .rain: "Light rain"
        case .storm: "Storm warning"
        }
    }

    func quip(_ tone: Tone) -> String {
        switch (tone, self) {
        case (.calm, .sunny): "Plenty of room today. A normal day fits with space to spare."
        case (.calm, .partly): "Everyday spending fits comfortably today."
        case (.calm, .cloudy): "A little tighter than your usual day."
        case (.calm, .rain): "Keep plans simple until payday."
        case (.calm, .storm): "Bills ahead are bigger than your cash. Hold off until payday."
        case (.spicy, .sunny): "Payday glow detected. Go ahead, buy the good olive oil."
        case (.spicy, .partly): "Scattered lattes, mostly harmless."
        case (.spicy, .cloudy): "Overcast. Your wallet requests a quiet night in."
        case (.spicy, .rain): "Rent incoming. Ninety percent chance of leftovers."
        case (.spicy, .storm): "Severe weather alert. Step away from the checkout button."
        }
    }
}
