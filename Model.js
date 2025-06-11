function deg2rad(angle) {
    return angle * Math.PI / 180;
}


function Vertex(p)
{
    this.p = p;
    this.normal = [];
    this.triangles = [];
}

function Triangle(v0, v1, v2)
{
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.normal = [];
    this.tangent = [];
}

// Constructor
function Model(name) {
    this.name = name;
    this.iVertexBuffer = gl.createBuffer();
    this.iIndexBuffer = gl.createBuffer();
    this.count = 0;

    this.BufferData = function(vertices, indices) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW); // Use STATIC_DRAW as data doesn't change

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW); // Use STATIC_DRAW

        this.count = indices.length;
    }

    /**
     * Binds the model's vertex and index buffers and enables the vertex attribute array.
     * This must be called before drawing the model.
     */
    this.Bind = function() {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.iVertexBuffer);
        gl.vertexAttribPointer(shProgram.iAttribVertex, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(shProgram.iAttribVertex);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iIndexBuffer);
    }

    /**
     * Unbinds the model's buffers and disables the vertex attribute array.
     * This is optional but good practice after drawing, especially if switching to other models.
     */
    this.Unbind = function() {
        gl.disableVertexAttribArray(shProgram.iAttribVertex);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }

    this.Draw = function() {
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }

    this.DrawWireframe = function() {
        // This method can be optimized, but for simplicity, we'll draw individual line loops
        for (let p=0; p < this.count; p+=3)
            gl.drawElements(gl.LINE_LOOP, 3, gl.UNSIGNED_SHORT, p*2);
    }
}


function CreateSurfaceData(uSteps, vSteps) {
    const vertexList = [];
    const indexList = [];
    const uMin = -2.0, uMax = 2.0;
    const vMin = -2.0, vMax = 2.0;
    const uStep = (uMax - uMin) / uSteps;
    const vStep = (vMax - vMin) / vSteps;
    
    // Генерація вершин
    for (let i = 0; i <= vSteps; i++) {
        for (let j = 0; j <= uSteps; j++) {
            const u = uMin + j * uStep;
            const v = vMin + i * vStep;
            // Формули для Richmond's Minimal Surface
            const x = (1/3) * Math.pow(u, 3) - u * Math.pow(v, 2) + u / (u*u + v*v);
            const y = -Math.pow(u, 2) * v + (1/3) * Math.pow(v, 3) - v / (u*u + v*v);
            const z = 2 * u;
            vertexList.push(x, y, z);
        }
    }
    
    // Генерація індексів для побудови трикутників
    for (let i = 0; i < vSteps; i++) {
        for (let j = 0; j < uSteps; j++) {
            const idx = i * (uSteps + 1) + j;
            indexList.push(idx, idx + 1, idx + uSteps + 1);
            indexList.push(idx + 1, idx + uSteps + 2, idx + uSteps + 1);
        }
    }
    
    return {
        verticesF32: new Float32Array(vertexList),
        indicesU16: new Uint16Array(indexList)
    };
}

// Додана функція для створення сфери
function CreateSphereData(segments, rings) {
    const vertices = [];
    const indices = [];

    const radius = 3.0; 

    for (let i = 0; i <= rings; i++) {
        const phi = i * Math.PI / rings;
        for (let j = 0; j <= segments; j++) {
            const theta = j * 2 * Math.PI / segments;

            const x = radius * Math.sin(phi) * Math.cos(theta);
            const y = radius * Math.sin(phi) * Math.sin(theta);
            const z = radius * Math.cos(phi);

            vertices.push(x, y, z);
        }
    }

    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < segments; j++) {
            const first = (i * (segments + 1)) + j;
            const second = first + segments + 1;

            indices.push(first, second, first + 1);
            indices.push(second, second + 1, first + 1);
        }
    }

    return {
        verticesF32: new Float32Array(vertices),
        indicesU16: new Uint16Array(indices)
    };
}
