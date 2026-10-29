import SwiftUI
import Supabase

/// Who's signed in and their latest rows. Root reads it to pick sign-up or the forecast.
@MainActor @Observable final class AppSession {
    enum State: Equatable { case starting, signedOut, signedIn }

    private(set) var state: State = .starting
    private(set) var loaded: Backend.Loaded?
    var error: String?

    /// Follows Supabase's auth events for as long as the app runs.
    func start() async {
        for await (event, session) in Backend.client.auth.authStateChanges {
            switch event {
            case .initialSession, .signedIn, .signedOut, .userDeleted:
                if session != nil {
                    await reload()
                    state = .signedIn
                } else {
                    loaded = nil
                    state = .signedOut
                }
            default: break
            }
        }
    }

    func reload() async {
        do {
            loaded = try await Backend.load()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Pull to refresh: asks Plaid for anything new, then reloads.
    func refresh() async {
        do {
            loaded = try await Backend.refresh()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The sign-in email's link opens the app here; Supabase then reports `.signedIn`.
    func open(_ url: URL) async {
        do {
            try await Backend.client.auth.session(from: url)
        } catch {
            self.error = "That sign-in link has expired. Send a new one."
        }
    }

    func signOut() async {
        try? await Backend.client.auth.signOut()
    }
}
