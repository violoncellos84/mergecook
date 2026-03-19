/**
 * main.js — Entry point.
 * Depends on: MC.Game (and transitively all other MC.* modules)
 */
window.addEventListener('load', function () {
    var game = new MC.Game();
    game.start();
});
