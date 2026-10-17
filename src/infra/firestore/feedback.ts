import { submitFeedback } from '../../firebase/feedback';
import type { FeedbackRepo } from '../repos';

/** FeedbackRepo on Firestore: the src/firebase function. */
export const feedbackRepo: FeedbackRepo = {
  submit: submitFeedback,
};
