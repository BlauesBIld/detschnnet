class MagicBarrierLayer extends ImageObject {
    angle = 0;
    speed = 0;
    opacityOfTile = 0;

    constructor(number) {
        super("magicBarrier", "OldMagicBarrier/MagicBarrier" + number + ".png", gameManager.gameCanvas.canvasBoundaries.right / 2 - 1250, 500, 2500, 2500);
        this.angle = 0;
        this.speed = (Math.random() * 0.1 - 0.05);
    }

    update() {
        this.angle += this.speed;
        if (this.angle >= 360) {
            this.angle = 0;
        }

        this.opacityOfTile += gameManager.magicBarrier.opacityDiff;
        if (this.opacityOfTile <= 0) {
            this.destroy();
            gameManager.magicBarrier.opacityDiff = 0;
        } else if (this.opacityOfTile > 1) {
            this.opacityOfTile = 1;
            gameManager.magicBarrier.opacityDiff = 0;
        }
    }

    draw() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.translate(this.position.x + (this.dimensions.width / 2), this.position.y + (this.dimensions.height / 2));
        gameManager.gameCanvas.drawLayer.rotate(this.angle * Math.PI / 180);
        gameManager.gameCanvas.drawLayer.globalAlpha = this.opacityOfTile;
        gameManager.gameCanvas.drawLayer.beginPath();
        gameManager.gameCanvas.drawLayer.drawImage(this.image, 0, 0, this.dimensions.width * (this.image.width / this.dimensions.width), this.dimensions.height * (this.image.height / this.dimensions.width), -(this.dimensions.width / 2), -(this.dimensions.width / 2), this.dimensions.width, this.dimensions.height);
        gameManager.gameCanvas.drawLayer.closePath();
        gameManager.gameCanvas.drawLayer.restore();
    }
}