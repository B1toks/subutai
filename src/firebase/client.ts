import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAbqverdzFCHOpJeoN8WI3_5CWUNWV6mhk',
  authDomain: 'subutai-chess.firebaseapp.com',
  projectId: 'subutai-chess',
  storageBucket: 'subutai-chess.firebasestorage.app',
  messagingSenderId: '1096425837150',
  appId: '1:1096425837150:web:012368d3b1d7583edc1acf',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
