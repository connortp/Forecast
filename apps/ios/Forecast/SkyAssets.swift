import Foundation
import CoreGraphics
import ForecastKit

/// The shared sky photos and loops from packages/design/sky, bundled as the `sky` folder.
/// index.json maps each condition and time of day to a plate, so web and iOS pick the same sky.
struct SkyAssets: Decodable {
    struct Video: Decodable { var src: String; var poster: String }
    struct Entry: Decodable { var plate: String; var brightness: Double?; var video: String? }

    /// How a photo sits behind the number, tuned by packages/design/scripts/hero-contrast.py:
    /// where it's framed and zoomed (`wide` reframes it for landscape), how far its exposure
    /// comes down, and how strong the soft scrim behind the number is.
    struct Hero: Decodable, Equatable {
        struct Framing: Decodable, Equatable { var focus: [Double]?; var zoom: Double? }
        var focus: [Double]?
        var zoom: Double?
        var wide: Framing?
        var scrim: Double?
        var exposure: Double?

        static let none = Hero()

        /// Focus (0...1 each way) and zoom for a window of this size.
        func framing(for size: CGSize) -> (focus: CGPoint, zoom: Double) {
            let isWide = size.width > size.height
            let f = (isWide ? wide?.focus : nil) ?? focus ?? [0.5, 0.5]
            return (CGPoint(x: f[0], y: f[1]), (isWide ? wide?.zoom : nil) ?? zoom ?? 1)
        }
    }

    var plates: [String: String]
    var videos: [String: Video]
    var conditions: [String: [String: Entry]]
    var hero: [String: Hero]?

    static let shared: SkyAssets? = {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "json", subdirectory: "sky"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SkyAssets.self, from: data)
    }()

    struct Resolved: Equatable {
        var plate: URL
        var brightness: Double
        var hero: Hero
        var video: URL?
        var videoHero: Hero
    }

    func resolve(_ condition: Condition, _ timeOfDay: TimeOfDay) -> Resolved? {
        guard let entry = conditions[condition.rawValue]?[timeOfDay.rawValue],
              let plate = plates[entry.plate].flatMap(Self.url) else { return nil }
        return Resolved(plate: plate, brightness: entry.brightness ?? 1, hero: hero?[entry.plate] ?? .none,
                        video: entry.video.flatMap { videos[$0] }.flatMap { Self.url($0.src) },
                        videoHero: entry.video.flatMap { hero?[$0] } ?? .none)
    }

    private static func url(_ file: String) -> URL? {
        Bundle.main.resourceURL?.appending(path: "sky").appending(path: file)
    }
}
