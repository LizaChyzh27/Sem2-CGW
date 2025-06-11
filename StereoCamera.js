class StereoCamera {
    constructor(convergence, eyeSeparation, aspectRatio, fov, near, far) {
        this.convergence = convergence;
        this.eyeSeparation = eyeSeparation;
        this.aspectRatio = aspectRatio;
        this.fov = fov;
        this.near = near;
        this.far = far;
    }

    calcLeftFrustum() {
        const top = this.near * Math.tan(this.fov / 2);
        const bottom = -top;
        const a = this.aspectRatio * Math.tan(this.fov / 2) * this.convergence;
        const b = a - this.eyeSeparation / 2;
        const c = a + this.eyeSeparation / 2;
        const left = -b * this.near / this.convergence;
        const right = c * this.near / this.convergence;
        return m4.frustum(left, right, bottom, top, this.near, this.far);
    }

    calcRightFrustum() {
        const top = this.near * Math.tan(this.fov / 2);
        const bottom = -top;
        const a = this.aspectRatio * Math.tan(this.fov / 2) * this.convergence;
        const b = a - this.eyeSeparation / 2;
        const c = a + this.eyeSeparation / 2;
        const left = -c * this.near / this.convergence;
        const right = b * this.near / this.convergence;
        return m4.frustum(left, right, bottom, top, this.near, this.far);
    }
}