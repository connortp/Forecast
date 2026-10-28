import SwiftUI
import AVFoundation

/// A muted, seamlessly looping video that fills its frame. It fades in once it starts playing,
/// so the still plate underneath shows until then.
struct LoopingVideo: UIViewRepresentable {
    var url: URL

    func makeUIView(context: Context) -> PlayerView { PlayerView(url: url) }
    func updateUIView(_ view: PlayerView, context: Context) { view.load(url) }

    final class PlayerView: UIView {
        override static var layerClass: AnyClass { AVPlayerLayer.self }
        private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        private let player = AVQueuePlayer()
        private var looper: AVPlayerLooper?
        private var url: URL?
        private var observation: NSKeyValueObservation?

        init(url: URL) {
            super.init(frame: .zero)
            player.isMuted = true
            player.preventsDisplaySleepDuringVideoPlayback = false
            playerLayer.player = player
            playerLayer.videoGravity = .resizeAspectFill
            playerLayer.opacity = 0
            observation = playerLayer.observe(\.isReadyForDisplay) { [weak self] layer, _ in
                guard layer.isReadyForDisplay else { return }
                DispatchQueue.main.async { self?.fadeIn() }
            }
            load(url)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        private func fadeIn() {
            CATransaction.begin()
            CATransaction.setAnimationDuration(0.8)
            playerLayer.opacity = 1
            CATransaction.commit()
        }

        func load(_ url: URL) {
            guard url != self.url else { return }
            self.url = url
            playerLayer.opacity = 0
            looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
            player.play()
        }
    }
}
