import {
    browserLocalPersistence,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    setPersistence,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { auth } from "./firebaseService.js";

export function persistAuthSession() {
    return setPersistence(auth, browserLocalPersistence);
}

export function watchAuthState(callback) {
    return onAuthStateChanged(auth, callback);
}

export function loginUser(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
}

export function registerUser(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
}

export function logoutUser() {
    return signOut(auth);
}
