import type { Locale } from '@i18n/config'

/**
 * Copy for the transactional newsletter mails and their result pages. Kept apart
 * from `@i18n/ui` because these strings are sent by the worker, not rendered into
 * a page, and the queue consumer must not pull the whole UI table into the bundle.
 */
export const newsletterMessages = {
  de: {
    confirmSubject: 'Bitte bestätigen Sie Ihr Newsletter-Abo',
    confirmIntro: 'Sie möchten den Newsletter von Ann-Kathrin Rahlwes erhalten. Bitte bestätigen Sie Ihre Adresse mit einem Klick:',
    confirmButton: 'Abo bestätigen',
    confirmIgnore: 'Wenn Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail einfach – ohne Bestätigung senden wir Ihnen nichts.',
    signup: {
      ok: 'Fast geschafft! Bitte bestätigen Sie den Link in der E-Mail, die wir Ihnen gerade geschickt haben.',
      invalid: 'Bitte geben Sie eine gültige E-Mail-Adresse an.',
      consent: 'Bitte stimmen Sie dem Erhalt des Newsletters zu.',
      rateLimited: 'Zu viele Anfragen in kurzer Zeit. Bitte versuchen Sie es in einer Minute erneut.',
      error: 'Die Anmeldung hat nicht geklappt. Bitte versuchen Sie es später erneut.',
    },
    unsubscribeLabel: 'Newsletter abbestellen',
    unsubscribeNote: 'Sie erhalten diese E-Mail, weil Sie den Newsletter abonniert haben.',
  },
  en: {
    confirmSubject: 'Please confirm your newsletter subscription',
    confirmIntro: 'You asked to receive the newsletter from Ann-Kathrin Rahlwes. Please confirm your address with one click:',
    confirmButton: 'Confirm subscription',
    confirmIgnore: 'If you did not sign up, simply ignore this email — without confirmation we will not send you anything.',
    signup: {
      ok: 'Almost there! Please confirm the link in the email we just sent you.',
      invalid: 'Please enter a valid email address.',
      consent: 'Please consent to receiving the newsletter.',
      rateLimited: 'Too many requests in a short time. Please try again in a minute.',
      error: 'The signup did not work. Please try again later.',
    },
    unsubscribeLabel: 'Unsubscribe',
    unsubscribeNote: 'You are receiving this email because you subscribed to the newsletter.',
  },
  fr: {
    confirmSubject: 'Veuillez confirmer votre abonnement à la newsletter',
    confirmIntro: 'Vous souhaitez recevoir la newsletter d’Ann-Kathrin Rahlwes. Veuillez confirmer votre adresse en un clic :',
    confirmButton: 'Confirmer l’abonnement',
    confirmIgnore: 'Si vous ne vous êtes pas inscrit, ignorez simplement cet e-mail — sans confirmation, nous ne vous enverrons rien.',
    signup: {
      ok: 'Presque terminé ! Veuillez confirmer le lien dans l’e-mail que nous venons de vous envoyer.',
      invalid: 'Veuillez indiquer une adresse e-mail valide.',
      consent: 'Veuillez consentir à recevoir la newsletter.',
      rateLimited: 'Trop de requêtes en peu de temps. Veuillez réessayer dans une minute.',
      error: 'L’inscription a échoué. Veuillez réessayer plus tard.',
    },
    unsubscribeLabel: 'Se désabonner',
    unsubscribeNote: 'Vous recevez cet e-mail parce que vous êtes abonné à la newsletter.',
  },
} satisfies Record<Locale, unknown>

export function newsletterCopy(locale: Locale) {
  return newsletterMessages[locale]
}
