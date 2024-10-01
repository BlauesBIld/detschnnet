class SlimeKing extends BossEnemy {
    wobbleSpeed = 0.06;
    maxWobbleOffset = 5;
    heightOrigin = 0;

    constructor(name) {
        super(name, "./Enemies/" + name + ".png", gameManager.gameCanvas.canvasBoundaries.right/2 - (monsters[name].size * waveManager.enemyDefaultSize)/2, 100, waveManager.enemyDefaultSize * monsters[name].size, waveManager.enemyDefaultSize * monsters[name].size);
        this.heightOrigin = this.dimensions.height;
    }

    update() {
        super.update();
        this.dimensions.height -= this.wobbleSpeed;
        if (this.dimensions.height < this.heightOrigin - this.maxWobbleOffset) {
            this.wobbleSpeed = -Math.abs(this.wobbleSpeed);
        } else if (this.dimensions.height >= this.heightOrigin) {
            this.wobbleSpeed = Math.abs(this.wobbleSpeed);
        }
    }
}