class MagicBarrier {
    magicBarrierLayers = [];
    magicBarrierTileDimensions = {
        height: 50,
        width: 260,
    }

    maxHealthPoints = 2000;
    currentHealthPoints = 2000;
    opacityDiff = 0;

    barrierWall = new GameObject("wall", 0, gameManager.gameCanvas.canvasBoundaries.bottom / 2, gameManager.gameCanvas.canvasBoundaries.right, 200)

    constructor() {
        this.barrierWall.destroy();
        for (let i = 1; i < 5; i++) {
            this.magicBarrierLayers.push(new MagicBarrierLayer(i));
        }
    }

    trackHealth() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.font = 'bold 25px \'MedievalSharp\'';
        gameManager.gameCanvas.drawLayer.fillStyle = 'black';
        gameManager.gameCanvas.drawLayer.textAlign = 'center';
        gameManager.gameCanvas.drawLayer.fillText("Magic Barrier Healthpoints: " + this.currentHealthPoints + "/" + this.maxHealthPoints, gameCanvas.canvasBoundaries.right / 2, 30);
        gameManager.gameCanvas.drawLayer.restore();
    }

    receiveDamage(amountOfDamage) {
        this.currentHealthPoints -= amountOfDamage;
        new FadingTextPopUp("-" + Math.floor(amountOfDamage), gameManager.gameCanvas.canvasBoundaries.right / 2, this.barrierWall.position.y + this.barrierWall.dimensions.height, 42, 1)
    }

    deactivateBarrier() {
        this.opacityDiff = -0.06;
        this.barrierWall.destroy();
        gameManager.castle.safeZone.recreate();
    }

    reactivateBarrier() {
        this.magicBarrierLayers.forEach(tile => tile.isActive = true);
        this.opacityDiff = 0.06;
        this.barrierWall.recreate();
        gameManager.castle.safeZone.destroy();
    }

    regen500HealthPoints() {
        this.currentHealthPoints += 500;
        if (this.currentHealthPoints > this.maxHealthPoints) {
            this.currentHealthPoints = this.maxHealthPoints;
        }
    }
}