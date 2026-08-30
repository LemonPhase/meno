/**
 * What a failed sign-in says to the person looking at it.
 *
 * Never the SDK's own `message`: it reads "Firebase: Error
 * (auth/unauthorized-domain)." — which names the fault without saying what
 * it is, what caused it, or who can fix it. The codes here are the ones
 * that actually reach a reader, and several of them are misconfigurations
 * rather than mistakes, so they say so: during setup the person reading
 * this *is* the operator, and "sign-in didn't go through" would send them
 * looking at their Google account instead of at their own console.
 *
 * Google is the only door, so the password codes are gone with the form
 * that raised them — they would be unreachable, and an unreachable branch
 * reads as a claim that something can still happen here.
 */
export function signInError(error: unknown): string {
  switch ((error as { code?: string })?.code ?? "") {
    // --- the project is not set up for this yet ---
    case "auth/unauthorized-domain":
      return "This site’s domain isn’t on Firebase’s authorised list, so sign-in was refused.";
    case "auth/operation-not-allowed":
      return "That sign-in method isn’t enabled for this project yet.";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid":
      return "This build is missing its Firebase configuration.";

    // --- the browser got in the way ---
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in window — allow pop-ups for this site and try again.";
    case "auth/network-request-failed":
      return "Couldn’t reach the server — check your connection.";

    // --- the account itself ---
    case "auth/account-exists-with-different-credential":
      return "You’ve signed in before using a different method for this email.";
    case "auth/too-many-requests":
      return "Too many attempts — wait a moment and try again.";
    case "auth/user-disabled":
      return "This account has been disabled.";

    default:
      return "Sign-in didn’t go through.";
  }
}
