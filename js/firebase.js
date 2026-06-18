// ===== CONFIGURAÇÃO DO FIREBASE =====
import { initializeApp } from "./vendor/firebase/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, setDoc, onSnapshot, addDoc, query, orderBy, getDocs, runTransaction, deleteDoc } from "./vendor/firebase/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD-whKWwiLo_D43XDWqAE275HollpG1QSA",
  authDomain: "apontamento-producao-d5716.firebaseapp.com",
  projectId: "apontamento-producao-d5716",
  storageBucket: "apontamento-producao-d5716.firebasestorage.app",
  messagingSenderId: "401986547343",
  appId: "1:401986547343:web:a9f1bbe226cead6ad0cafa"
};

const app = initializeApp(firebaseConfig);
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({tabManager:persistentMultipleTabManager()})
  });
} catch {
  db = getFirestore(app);
}

// Exporta tudo que vai ser usado pelos outros módulos
window.firebaseDB = {
  db, collection, doc, setDoc, onSnapshot, addDoc,
  query, orderBy, getDocs, runTransaction, deleteDoc
};
