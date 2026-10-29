@preconcurrency import LinkKit
import UIKit

/// Opens Plaid Link over the app and hands back the public token, or nil if the person closed it.
@MainActor enum PlaidLink {
    struct Linked {
        var publicToken: String
        var institutionId: String
        var institutionName: String
    }

    /// Plaid needs its handler kept alive while Link is on screen.
    private static var handler: (any Handler)?

    static func open(token: String) async throws -> Linked? {
        defer { handler = nil }
        return try await withCheckedThrowingContinuation { done in
            var config = LinkTokenConfiguration(token: token) { success in
                let i = success.metadata.institution
                done.resume(returning: Linked(publicToken: success.publicToken, institutionId: i.id, institutionName: i.name))
            }
            config.onExit = { exit in
                if let error = exit.error {
                    done.resume(throwing: Problem(error.displayMessage ?? "The bank connection closed before it finished."))
                } else {
                    done.resume(returning: nil)
                }
            }
            switch Plaid.create(config) {
            case .success(let h):
                guard let top = topViewController() else {
                    return done.resume(throwing: Problem("Couldn't open the bank connection. Try again."))
                }
                handler = h
                h.open(presentUsing: .viewController(top))
            case .failure:
                done.resume(throwing: Problem("Couldn't open the bank connection. Try again."))
            }
        }
    }

    private static func topViewController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        var top = window?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
}
