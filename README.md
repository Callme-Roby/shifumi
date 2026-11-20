# Shifumi

Pierre, feuille, ciseaux en pixel art, à jouer contre ses amis avec un simple lien d'invitation.

- Tons blanc cassé / beige, éléments noirs, rendu pixel net à toutes les tailles d'écran.
- Chaque manche : on choisit sa main à l'avance, puis les deux poings s'agitent (« CHI… FOU… MI ! ») avant de s'ouvrir sur la forme choisie.
- Premier à 3 manches gagnantes, avec revanche.
- Mode entraînement contre l'ordinateur.
- Petits sons 8 bits (désactivables) et vibrations sur mobile.
- Raccourcis clavier : `1` / `2` / `3` (ou `P` / `F` / `C`).

## Jouer avec un ami

1. Clique sur **Créer une partie**.
2. Envoie le lien affiché (bouton **Copier** ou **Partager**).
3. Ton ami ouvre le lien et clique sur **Rejoindre**. C'est parti.

Si l'un des deux quitte ou recharge la page, l'autre reste dans la partie : rouvrir le même lien suffit pour reprendre.

## Comment ça marche

Le jeu est un site 100 % statique : pas de serveur à héberger.

- **Connexion pair-à-pair** : les deux navigateurs se parlent directement en WebRTC grâce à [PeerJS](https://peerjs.com). Le serveur public gratuit de PeerJS (`0.peerjs.com`) sert seulement à la mise en relation ; ensuite, les échanges passent de navigateur à navigateur.
- **Le lien d'invitation** contient un code de partie (`…/#k7m2pq`). Le premier qui ouvre le lien « réserve » ce code et attend ; le second s'y connecte.
- **Pas de triche possible** : à chaque manche, chaque joueur envoie d'abord une empreinte SHA-256 de son choix (avec un nombre aléatoire), puis ne révèle son choix qu'une fois l'empreinte de l'adversaire reçue. Personne ne peut voir la main de l'autre avant d'avoir verrouillé la sienne.

## Mettre en ligne

N'importe quel hébergement de fichiers statiques convient (HTTPS requis pour que le jeu en ligne fonctionne partout).

**GitHub Pages** : dans le dépôt, *Settings → Pages → Build and deployment → Deploy from a branch*, choisis la branche (par ex. `main`) et le dossier `/ (root)`. Le jeu sera disponible sur `https://<utilisateur>.github.io/shifumi/`.

## Tester en local

Les modules JavaScript ne se chargent pas en `file://`, il faut un petit serveur :

```bash
python3 -m http.server 8000
```

Puis ouvre <http://localhost:8000>. Pour jouer contre toi-même, ouvre le lien d'invitation dans une autre fenêtre (ou une fenêtre de navigation privée).

Pour tester sans dépendre du serveur public PeerJS, lance ton propre serveur de mise en relation :

```bash
npx peer --port 9000
```

et ouvre <http://localhost:8000/?peer=localhost:9000> (ce paramètre n'est pris en compte que sur `localhost`).

## Fichiers

```
index.html          page unique
css/style.css       mise en page et boutons pixel
js/sprites.js       dessins des mains (grilles de pixels) et police bitmap 5×7
js/stage.js         l'arène : animation des poings, révélation, confettis
js/game.js          règles et protocole d'une manche (engagement / révélation)
js/net.js           salons pair-à-pair (PeerJS) et adversaire ordinateur
js/hash.js          SHA-256 et tirages aléatoires
js/sound.js         effets sonores 8 bits (WebAudio)
js/main.js          écrans et enchaînement de la partie
vendor/peerjs.min.js
fonts/              police Silkscreen
```

## Limites

- Le mode en ligne dépend du serveur public gratuit de PeerJS pour la mise en relation. S'il est indisponible, on peut héberger son propre serveur (`npx peer`) et l'indiquer dans `peerOptions()` (`js/net.js`).
- Certains réseaux très filtrés (entreprise, école) bloquent WebRTC ; les serveurs relais TURN fournis par PeerJS contournent la plupart des cas, mais pas tous.

## Crédits

- Police [Silkscreen](https://github.com/googlefonts/silkscreen) de Jason Kottke, licence SIL Open Font License 1.1 (`fonts/OFL.txt`).
- [PeerJS](https://github.com/peers/peerjs), licence MIT (`vendor/peerjs.LICENSE`).
