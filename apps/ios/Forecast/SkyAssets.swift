import Foundation
import ForecastKit

/// The shared sky photos and loops from packages/design/sky, bundled as the `sky` folder.
/// index.json maps each condition and time of day to a plate, so web and iOS pick the same sky.
struct SkyAssets: Decodable {
    struct Video: Decodable { var src: String; var poster: String }
    struct Entry: Decodable { var plate: String; var brightness: Double?; var video: String? }

    var plates: [String: String]
    var videos: [String: Video]
    var conditions: [String: [String: Entry]]

    static let shared: SkyAssets? = {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "json", subdirectory: "sky"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SkyAssets.self, from: data)
    }()

    struct Resolved: Equatable {
        var plate: URL
        var brightness: Double
        var video: URL?
    }

    func resolve(_ condition: Condition, _ timeOfDay: TimeOfDay) -> Resolved? {
        guard let entry = conditions[condition.rawValue]?[timeOfDay.rawValue],
              let plate = plates[entry.plate].flatMap(Self.url) else { return nil }
        return Resolved(plate: plate, brightness: entry.brightness ?? 1,
                        video: entry.video.flatMap { videos[$0] }.flatMap { Self.url($0.src) })
    }

    private static func url(_ file: String) -> URL? {
        Bundle.main.resourceURL?.appending(path: "sky").appending(path: file)
    }
}
