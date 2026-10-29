import SwiftUI
import UIKit
import CoreText

// Colors and type, matching apps/web/src/app/globals.css.
enum Palette {
    static let sheet = Color(hex: 0x0A0A0B)
    /// The navy of the sky's shade and the scrim behind the number.
    static let shade = Color(hex: 0x080A16)
    static let pay = Color(hex: 0x5B8FD6)
    static let payLine = Color(hex: 0xCFE0FF)
    static let card = Color(hex: 0x121214)
    static let cardHi = Color(hex: 0x17171A)
    static let line = Color.white.opacity(0.08)
    static let ink = Color(hex: 0xF4F1EA)
    static let ink2 = ink.opacity(0.66)
    static let ink3 = ink.opacity(0.4)
    static let sun = Color(hex: 0xFFC65C)
    static let good = Color(hex: 0x8FE3B0)
    static let bad = Color(hex: 0xFF8D7A)
    static let rain = Color(hex: 0x8DB8FF)
    static let buckets = [Color(hex: 0xA8E6C0), Color(hex: 0xFFC9A6), Color(hex: 0xA9C8FF), Color(hex: 0xE4C4FF)]
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }
}

/// Newsreader (serif) for the number and headlines, Geist for body text, Geist Mono for labels and figures.
/// Both are variable fonts, so weight and optical size are set through font variations.
enum Typography {
    static func registerFonts() {
        for name in ["Newsreader", "Newsreader-Italic", "Geist", "GeistMono"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    static func serif(_ size: CGFloat, weight: CGFloat = 400, italic: Bool = false) -> Font {
        variable(italic ? "Newsreader16pt-Italic" : "Newsreader16pt-Regular", size: size,
                 axes: ["wght": weight, "opsz": min(72, max(6, size))], fallback: .system(size: size, design: .serif))
    }

    static func sans(_ size: CGFloat, weight: CGFloat = 400) -> Font {
        variable("Geist-Regular", size: size, axes: ["wght": weight], fallback: .system(size: size))
    }

    static func mono(_ size: CGFloat, weight: CGFloat = 400) -> Font {
        variable("GeistMono-Regular", size: size, axes: ["wght": weight], fallback: .system(size: size, design: .monospaced))
    }

    private static func variable(_ name: String, size: CGFloat, axes: [String: CGFloat], fallback: Font) -> Font {
        let variations = Dictionary(uniqueKeysWithValues: axes.map { (fourCC($0.key), $0.value) })
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: name,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): variations,
        ])
        let font = UIFont(descriptor: descriptor, size: size)
        return font.fontName.hasPrefix(name.prefix(6)) ? Font(font) : fallback
    }

    private static func fourCC(_ tag: String) -> Int {
        tag.utf8.reduce(0) { $0 << 8 | Int($1) }
    }
}

/// Small uppercase mono label, used for section titles and captions.
struct Eyebrow: View {
    var text: String
    var color = Palette.ink3
    var body: some View {
        Text(text.uppercased())
            .font(Typography.mono(11, weight: 500))
            .tracking(1.8)
            .foregroundStyle(color)
    }
}
