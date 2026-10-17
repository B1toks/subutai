import { changeDisplayName, claimDisplayName, isDisplayNameAvailable } from '../../firebase/auth';
import type { ProfileRepo } from '../repos';

/** ProfileRepo on Firestore: each call is the src/firebase function. */
export const profileRepo: ProfileRepo = {
  claimName: claimDisplayName,
  changeName: changeDisplayName,
  isNameAvailable: isDisplayNameAvailable,
};
