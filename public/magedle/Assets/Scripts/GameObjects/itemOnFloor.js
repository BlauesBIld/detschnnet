class ItemOnFloor extends ImageObject {
    autoPickUp;

    floatSpeed = 0.17;
    maxOffset = 5;
    originalPosY;

    constructor(name, fileName, x, y, width, height, autoPickUp = false) {
        super(name, fileName, x, y, width, height);
        this.originalPosY = y;
        this.autoPickUp = autoPickUp;
        waveManager.itemsOnTheFloor.push(this);
    }

    update() {
        this.position.y += this.floatSpeed;
        if (this.position.y > this.originalPosY + this.maxOffset || this.position.y < this.originalPosY - this.maxOffset) {
            this.floatSpeed = -this.floatSpeed;
        }
    }

    draw() {
        this.drawShadow();
        super.draw();
    }

    drawShadow() {
        gameManager.gameCanvas.drawLayer.save();
        gameManager.gameCanvas.drawLayer.beginPath();
        gameManager.gameCanvas.drawLayer.globalAlpha = 0.3;
        gameManager.gameCanvas.drawLayer.ellipse(this.position.x + this.dimensions.width / 2, (this.originalPosY + this.dimensions.height / 2) + this.dimensions.height * 0.4, this.dimensions.width / 2 - (this.dimensions.height / this.dimensions.width) * 5 + (this.position.y - this.originalPosY) * 0.6 - this.maxOffset, this.dimensions.height / 2 - (this.dimensions.width / this.dimensions.height) * 5 + (this.position.y - this.originalPosY) * 0.3 - this.maxOffset, 0, 2 * Math.PI, false);
        gameManager.gameCanvas.drawLayer.fillStyle = 'black';
        gameManager.gameCanvas.drawLayer.fill();
        gameManager.gameCanvas.drawLayer.closePath();
        gameManager.gameCanvas.drawLayer.restore();
    }


    onCollision(otherObject) {
        if (otherObject.name === 'player') {
            if (this.autoPickUp) {
                playerManager.pickUpItem(this);
                this.destroy();
            } else {
                if (!uiManager.currentPage instanceof ItemOnFloor || uiManager.currentPage === undefined) {
                    uiManager.currentPage = this;
                    uiManager.initializePage();
                }
            }
        }
    }
}