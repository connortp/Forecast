import AuthenticationServices
import CryptoKit
import Supabase

/// Sign in with Apple (the native sheet) and Google (a web sheet that returns to the app).
/// Both providers have to be switched on in Supabase > Authentication > Sign In / Providers.
@MainActor enum SocialSignIn {
    static func apple() async throws {
        let nonce = randomNonce()
        let credential = try await AppleSheet().present(hashedNonce: sha256(nonce))
        guard let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }) else {
            throw Problem("Apple didn't send back a sign-in. Try again.")
        }
        do {
            try await Backend.client.auth.signInWithIdToken(credentials: .init(provider: .apple, idToken: token, nonce: nonce))
        } catch {
            throw friendly(error, provider: "Apple")
        }
    }

    static func google() async throws {
        do {
            try await Backend.client.auth.signInWithOAuth(provider: .google, redirectTo: Backend.redirect) { session in
                session.prefersEphemeralWebBrowserSession = false
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        } catch {
            throw friendly(error, provider: "Google")
        }
    }

    /// Supabase answers "provider is not enabled" until the dashboard switch is on.
    private static func friendly(_ error: Error, provider: String) -> Error {
        let text = error.localizedDescription.lowercased()
        if text.contains("not enabled") || text.contains("unsupported provider") {
            return Problem("\(provider) sign-in isn't switched on yet. Use email for now.")
        }
        return Problem("\(provider) sign-in didn't work. Try again, or use email.")
    }

    private static func randomNonce() -> String {
        (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    private static func sha256(_ s: String) -> String {
        SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Wraps ASAuthorizationController's delegate callbacks in one async call.
@MainActor private final class AppleSheet: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var done: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?

    func present(hashedNonce: String) async throws -> ASAuthorizationAppleIDCredential {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.email]
        request.nonce = hashedNonce
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        return try await withCheckedThrowingContinuation { continuation in
            done = continuation
            controller.performRequests()
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated {
            if let credential = authorization.credential as? ASAuthorizationAppleIDCredential {
                done?.resume(returning: credential)
            } else {
                done?.resume(throwing: Problem("Apple didn't send back a sign-in. Try again."))
            }
            done = nil
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated {
            let canceled = (error as? ASAuthorizationError)?.code == .canceled
            done?.resume(throwing: canceled ? CancellationError() : error)
            done = nil
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
}
