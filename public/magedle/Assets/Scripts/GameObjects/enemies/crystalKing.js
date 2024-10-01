class CrystalKing extends BossEnemy {
    smallerCrystals = [];
    smallerCrystalsSize;

    constructor(name) {
        super(name);
        this.smallerCrystalsSize = this.dimensions.height / 4;
        this.initializeSmallerCrystals();
    }


    update() {
        super.update();
        for (let i = 0; i < 4; i++) {
            this.smallerCrystals[i].x += this.smallerCrystals[i].dir / 2;
            if (this.smallerCrystals[i].x >= this.dimensions.width - this.smallerCrystalsSize + this.smallerCrystals[i].exceedOffSetX) {
                this.smallerCrystals[i].dir = -1;
                this.smallerCrystals[i].zIndex = -this.smallerCrystals[i].zIndex;
            } else if (this.smallerCrystals[i].x <= 0 - this.smallerCrystals[i].exceedOffSetX) {
                this.smallerCrystals[i].dir = 1;
                this.smallerCrystals[i].zIndex = -this.smallerCrystals[i].zIndex;
            }
        }
    }

    draw() {
        for (let i = 0; i < 4; i++) {
            if (this.smallerCrystals[i].zIndex > 0) {
                gameManager.gameCanvas.drawLayer.beginPath();
                let width = this.dimensions.width / 3;
                let height = this.dimensions.height / 3;
                gameManager.gameCanvas.drawLayer.drawImage(this.image, 0, 0, width * (this.image.width / width), height * (this.image.height / height), this.position.x + this.smallerCrystals[i].x, this.position.y + this.smallerCrystals[i].y, width, height);
                gameManager.gameCanvas.drawLayer.closePath();
            }
        }
        super.draw();
        for (let i = 0; i < 4; i++) {
            if (this.smallerCrystals[i].zIndex < 0) {
                gameManager.gameCanvas.drawLayer.beginPath();
                let width = this.dimensions.width / 3;
                let height = this.dimensions.height / 3;
                gameManager.gameCanvas.drawLayer.drawImage(this.image, 0, 0, width * (this.image.width / width), height * (this.image.height / height), this.position.x + this.smallerCrystals[i].x, this.position.y + this.smallerCrystals[i].y, width, height);
                gameManager.gameCanvas.drawLayer.closePath();
            }
        }
    }

    initializeSmallerCrystals() {
        let correctionOnY = 10;
        this.smallerCrystals = [{
            x: -(this.smallerCrystalsSize / 2),
            y: -(this.smallerCrystalsSize / 2) - correctionOnY,
            dir: 1,
            zIndex: 1,
            exceedOffSetX: -5
        }, {
            x: -(this.smallerCrystalsSize / 2) + this.dimensions.width,
            y: -(this.smallerCrystalsSize / 2) + this.dimensions.height - correctionOnY,
            dir: -1,
            zIndex: -1,
            exceedOffSetX: -5
        }, {
            x: -(this.smallerCrystalsSize / 2) + this.dimensions.width / 2,
            y: -(this.smallerCrystalsSize / 2) + this.dimensions.height / 4 - correctionOnY,
            dir: -1,
            zIndex: -1,
            exceedOffSetX: 5
        }, {
            x: -(this.smallerCrystalsSize / 2) + this.dimensions.width / 2,
            y: -(this.smallerCrystalsSize / 2) + this.dimensions.height / 4 * 3 - correctionOnY,
            dir: 1,
            zIndex: 1,
            exceedOffSetX: 5
        }];
        console.log(this.smallerCrystals);
    }
}