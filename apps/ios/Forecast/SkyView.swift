import SwiftUI
import UIKit
import ForecastKit

enum TimeOfDay: String, CaseIterable {
    case dawn, day, dusk, night

    static var now: TimeOfDay {
        let h = Calendar.current.component(.hour, from: .now)
        return h < 5 || h >= 21 ? .night : h < 9 ? .dawn : h < 17 ? .day : .dusk
    }
}

/// The full-screen sky behind the number.
///
/// The sky is one of the shared photo plates from packages/design/sky, chosen by index.json,
/// with a gentle looping video over it where the index names one. If the plates are missing,
/// it falls back to a soft, slowly moving mesh gradient with out-of-focus clouds.
struct SkyView: View {
    var condition: Condition
    var timeOfDay: TimeOfDay

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if let sky = SkyAssets.shared?.resolve(condition, timeOfDay) {
                Plate(sky: sky, animate: !reduceMotion)
            } else {
                TimelineView(.animation(paused: reduceMotion)) { context in
                    let t = context.date.timeIntervalSinceReferenceDate
                    ZStack {
                        mesh(t)
                        orb
                        clouds(t)
                    }
                }
            }
            // Storm plates have no loop of their own, so they get a faint drawn rain.
            if condition == .storm || (condition == .rain && SkyAssets.shared == nil) {
                RainView(heavy: condition == .storm, night: timeOfDay == .night)
            }
            if condition == .storm && !reduceMotion { LightningView() }
            LinearGradient(colors: [.clear, Palette.sheet.opacity(0.35)], startPoint: .init(x: 0.5, y: 0.65), endPoint: .bottom)
            Grain().opacity(0.07).blendMode(.overlay)
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 1.2), value: condition)
        .animation(.easeInOut(duration: 1.2), value: timeOfDay)
    }

    // MARK: Fallback sky

    private var tone: (gray: Double, dark: Double) {
        switch condition {
        case .sunny: (0, 0)
        case .partly: (0.12, 0.03)
        case .cloudy: (0.55, 0.12)
        case .rain: (0.7, 0.3)
        case .storm: (0.75, 0.55)
        }
    }

    // [zenith, middle, horizon] for a clear sky, as on the web.
    private var stops: [UInt32] {
        switch timeOfDay {
        case .dawn: [0x3B4F86, 0xC48AA0, 0xFFC9A3]
        case .day: [0x1B5FB8, 0x4D97DF, 0xA9D6F5]
        case .dusk: [0x24264F, 0x8A4F7D, 0xFF9F6E]
        case .night: [0x060A18, 0x0F1A36, 0x24365E]
        }
    }

    private func toned(_ hex: UInt32) -> Color {
        let r = Double((hex >> 16) & 0xFF), g = Double((hex >> 8) & 0xFF), b = Double(hex & 0xFF)
        let l = 0.3 * r + 0.59 * g + 0.11 * b
        let f = { (c: Double) in (c + (l - c) * tone.gray) * (1 - tone.dark) / 255 }
        return Color(.sRGB, red: f(r), green: f(g), blue: f(b))
    }

    private func mesh(_ t: Double) -> some View {
        let c = stops.map(toned)
        let (z, m, h) = (c[0], c[1], c[2])
        let w = { (phase: Double) in Float(sin(t / 9 + phase) * 0.06) }
        return MeshGradient(
            width: 3, height: 3,
            points: [
                [0, 0], [0.5, 0], [1, 0],
                [0, 0.5 + w(0)], [0.5 + w(1), 0.55 + w(2)], [1, 0.5 + w(3)],
                [0, 1], [0.5, 1], [1, 1],
            ],
            colors: [z, z.mix(with: m, by: 0.3), z, m, m, m.mix(with: h, by: 0.4), h, h, h]
        )
    }

    @ViewBuilder private var orb: some View {
        let strength = max(0, 1 - tone.gray * 1.2)
        if strength > 0.2 {
            let night = timeOfDay == .night
            let glow: Color = night ? Color(hex: 0xC8D7FF) : timeOfDay == .day ? Color(hex: 0xFFECB4) : Color(hex: 0xFFBE8C)
            GeometryReader { geo in
                let y = timeOfDay == .day ? 0.13 : night ? 0.15 : 0.24
                Circle()
                    .fill(RadialGradient(colors: [glow.opacity(0.75 * strength), glow.opacity(0.2 * strength), .clear],
                                         center: .center, startRadius: 0, endRadius: 220))
                    .frame(width: 440, height: 440)
                    .position(x: geo.size.width * 0.76, y: geo.size.height * y)
                    .blur(radius: 20)
            }
        }
    }

    /// Out-of-focus clouds: a few big, soft shapes that drift very slowly.
    private func clouds(_ t: Double) -> some View {
        let count: Int = switch condition {
        case .sunny: 2
        case .partly: 4
        case .cloudy: 7
        case .rain: 7
        case .storm: 8
        }
        let night = timeOfDay == .night
        let lit: Color = night ? Color(hex: 0x96A5C3) : timeOfDay == .dusk ? Color(hex: 0xFFD6C4) : timeOfDay == .dawn ? Color(hex: 0xFFE2D6) : .white
        let shade: Color = condition == .storm ? Color(hex: 0x464E60) : condition == .rain ? Color(hex: 0x78828F) : lit
        let opacity = night ? 0.35 : condition == .sunny ? 0.45 : 0.6
        return GeometryReader { geo in
            ForEach(0..<count, id: \.self) { i in
                let seed = Double(i) * 1.618
                let width = geo.size.width * (0.7 + (seed.truncatingRemainder(dividingBy: 1)) * 0.6)
                let speed = 4 + Double(i % 3) * 2 // points per second
                let span = geo.size.width + width
                let x = (seed * 173 + t * speed).truncatingRemainder(dividingBy: span) - width / 2
                let band = count > 4 ? 0.6 : 0.4
                let y = geo.size.height * (0.05 + (seed * 0.37).truncatingRemainder(dividingBy: 1) * band)
                Ellipse()
                    .fill(LinearGradient(colors: [lit, shade], startPoint: .top, endPoint: .bottom))
                    .frame(width: width, height: width * 0.32)
                    .opacity(opacity)
                    .blur(radius: 38)
                    .position(x: x, y: y)
            }
        }
    }
}

private struct Plate: View {
    var sky: SkyAssets.Resolved
    var animate: Bool

    var body: some View {
        GeometryReader { geo in
            ZStack {
                if let image = UIImage(contentsOfFile: sky.plate.path) {
                    Image(uiImage: image).resizable().scaledToFill()
                }
                if animate, let video = sky.video {
                    LoopingVideo(url: video)
                }
                Color.black.opacity(1 - sky.brightness)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
        .id(sky.plate) // crossfade between plates instead of morphing
        .transition(.opacity)
    }
}

/// Fine slanted streaks, kept faint so the sky still reads as a photograph.
private struct RainView: View {
    var heavy: Bool
    var night: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            Canvas { ctx, size in
                let t = context.date.timeIntervalSinceReferenceDate
                let count = heavy ? 120 : 70
                var path = Path()
                for i in 0..<count {
                    let s = Double(i)
                    let speed = 600 + (s * 37).truncatingRemainder(dividingBy: 300)
                    let len = 14 + (s * 13).truncatingRemainder(dividingBy: 14)
                    let y = (s * 97 + t * speed).truncatingRemainder(dividingBy: size.height + len) - len
                    let x = (s * 61.3).truncatingRemainder(dividingBy: size.width + 80) - y * 0.18
                    path.move(to: CGPoint(x: x, y: y))
                    path.addLine(to: CGPoint(x: x - len * 0.18, y: y + len))
                }
                ctx.stroke(path, with: .color(night ? Color(hex: 0xAABEE6, opacity: 0.22) : Color(hex: 0xDCE8FF, opacity: 0.3)), lineWidth: 1)
            }
        }
        .blur(radius: 0.6)
        .allowsHitTesting(false)
    }
}

private struct LightningView: View {
    @State private var flash = 0.0

    var body: some View {
        Color(hex: 0xDFE8FF)
            .opacity(flash)
            .allowsHitTesting(false)
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(Double.random(in: 4...10)))
                    flash = 0.22
                    withAnimation(.easeOut(duration: 0.7)) { flash = 0 }
                }
            }
    }
}

/// Film grain, drawn once.
private struct Grain: View {
    var body: some View {
        Canvas { ctx, size in
            var rng = SystemRandomNumberGenerator()
            for _ in 0..<Int(size.width * size.height / 18) {
                let x = Double.random(in: 0..<size.width, using: &rng)
                let y = Double.random(in: 0..<size.height, using: &rng)
                ctx.fill(Path(CGRect(x: x, y: y, width: 1, height: 1)),
                         with: .color(.white.opacity(Double.random(in: 0...1, using: &rng))))
            }
        }
        .drawingGroup()
        .allowsHitTesting(false)
    }
}
