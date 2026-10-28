// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ForecastKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [.library(name: "ForecastKit", targets: ["ForecastKit"])],
    targets: [
        .target(name: "ForecastKit"),
        .testTarget(name: "ForecastKitTests", dependencies: ["ForecastKit"]),
    ]
)
