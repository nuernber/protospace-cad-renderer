import * as THREE from 'three';
import { OrbitControls } from './src/lib/OrbitControls.js';
import { LayeredRenderer } from './src/renderer/LayeredRenderer.js';
import { ModelRenderLayer } from './src/renderer/ModelRenderLayer.js';
import { ModelCaster } from './src/renderer/ModelCaster.js';
import { Model } from './src/model/Model.js';
import { AnimationPlayer } from './src/model/AnimationPlayer.js';
import { AnnotationRenderLayer } from './src/renderer/AnnotationRenderLayer.js';
import { fetchWithProgress } from './src/utilities/fetchWithProgress.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

function numberWithCommas( x ) {

	return x.toString().replace( /\B(?=(\d{3})+(?!\d))/g, ',' );

}

function writeOutput( msg ) {

	const el = document.getElementById( 'output' );

	if ( model ) {

		el.innerText = '';
		if ( msg ) {

			el.innerText = msg + '\n\n';

		}

		const metadata = model.metadata;
		el.innerText +=
			'triangles'.padEnd( 14, ' ' ) + ': ' + numberWithCommas( metadata.num_tris_per_lod[ lod ] ) +
			'\nobjects'.padEnd( 15, ' ' ) + ': ' + numberWithCommas( metadata.num_nodes ) +
			'\nmeshes'.padEnd( 15, ' ' ) + ': ' + numberWithCommas( metadata.num_leaves );

	} else {

		el.innerText = msg;

	}

}

const params = new URLSearchParams( window.location.search );
const lod = params.get( 'lod' ) === null ? 2 : parseInt( params.get( 'lod' ) );
const urlStem = './models/m2020-rover/';
const hierarchyUrl = urlStem + 'hierarchy.json';
const metadataUrl = urlStem + 'metadata.json';
const meshStatsUrl = urlStem + 'mesh_stats.json';
let model;
let numFramesRendering = 0;
let numFramesForLastRender = 0;

init();

async function init() {

	let loaded = new Array( 3 ).fill( 0 );
	let totals = new Array( 3 ).fill( 0 );
	function updateProgressDisplay() {

		if ( totals.includes( 0 ) ) return;

		let totalValue = 0;
		let loadedValue = 0;
		for ( let i = 0; i < 3; i ++ ) {

			loadedValue += loaded[ i ];
			totalValue += totals[ i ];

		}

		let perc = loadedValue / totalValue;
		writeOutput( `Loading model metadata... ${ ( perc * 100 ).toFixed( 2 ) }%` );

	}


	writeOutput( 'Loading model metadata...' );
	const [ hierarchy, metadata, meshStats ] = await Promise.all( [
		fetchWithProgress( hierarchyUrl, ( l, t ) => {

			loaded[ 0 ] = l;
			totals[ 0 ] = t;
			updateProgressDisplay();

		} ).then( res => res.json() ),
		fetchWithProgress( metadataUrl, ( l, t ) => {

			loaded[ 1 ] = l;
			totals[ 1 ] = t;
			updateProgressDisplay();

		} ).then( res => res.json() ),
		fetchWithProgress( meshStatsUrl, ( l, t ) => {

			loaded[ 2 ] = l;
			totals[ 2 ] = t;
			updateProgressDisplay();

		} ).then( res => res.json() ),
	] );

	metadata.name = '';

	writeOutput( 'Downloading model archive...' );
	model = new Model( hierarchy, metadata, meshStats, urlStem, { maxLod: lod } );
	const animationPlayer = new AnimationPlayer( model );

	// if (model.preprocessDone) {
	//     writeOutput('');
	// } else {
	//   model.listen('preprocessing', e => {
	//     writeOutput(`${e.detail.count} nodes processed`);
	//   });
	//   model.listen('preprocess-complete', writeOutput(''));
	// }

	model.listen( 'node-geometry-loaded', e => {

		const { totalLoads, remainingLoads } = e.detail;
		const loaded = totalLoads - remainingLoads;
		writeOutput( `${loaded} / ${totalLoads} meshes processed...` );

	} );
	model.listen( 'geometry-load-complete', e => {

		writeOutput( '' );

	} );
	model.listen( 'model-binaries-download-progress', e => {

		const { archive, archivesDownloadStatus } = e.detail;
		const info = archivesDownloadStatus[ archive ];
		const perc = info.loaded / info.total;
		writeOutput( `Downloading model archive... ${ ( perc * 100 ).toFixed( 2 ) }%` );

	} );


	// create the renderer
	const backgroundColor = new THREE.Color( 0x1d2123 );
	const renderer = new LayeredRenderer( backgroundColor );
	const element = renderer.domElement;
	renderer.prerender = function ( width, height ) {

		if ( model.geometryLoaded ) {

			const colorRendering = colorLayer.needsToDraw() && colorLayer.isVisible();
			const highlightRendering = highlightLayer.needsToDraw() && highlightLayer.isVisible();
			if ( colorRendering || highlightRendering ) {

				writeOutput( 'rendering...' );
				
				numFramesRendering++;
				numFramesForLastRender = numFramesRendering;

			} else {

				writeOutput( 'Finished in ' + numFramesForLastRender + ' frames' );
				numFramesRendering = 0;

			}

		}

		// TODO: do this in a resize event
		colorLayer.camera.setSize( width, height );
		colorLayer.camera.updateMatrixWorld( true );
		colorLayer.camera.updateProjectionMatrix();
		controls.update();

		if ( model && ! model.geometryLoaded ) {

			colorLayer.redraw();
			highlightLayer.redraw();

		}

	};

	document.body.appendChild( element );
	element.style.width = '100%';
	element.style.height = '100%';

	const modelToWorld = new THREE.Matrix4().makeRotationFromEuler( new THREE.Euler( Math.PI / 2, 0, 0 ) );

	// TODO: move config to a constructor interface or just fields
	// instead of referencing it in the file
	// create the layers
	const colorLayer = new ModelRenderLayer( model, 0, 'color' );
	colorLayer.modelToWorld.copy( modelToWorld );

	const ambientLight = new THREE.AmbientLight( 0xffffff, 0.5 );
	const directionalLight = new THREE.DirectionalLight( 0xffffff, 2.5 );
	directionalLight.position.set( 1, 3, 2 );
	directionalLight.updateMatrixWorld();

	const controls = new OrbitControls( colorLayer.camera, element );
	controls.maxDistance = 50;
	controls.minDistance = 0.25;
	controls.target.y = - 0.25;
	controls.addEventListener( 'change', () => {

		colorLayer.redraw();
		highlightLayer.redraw();

		numFramesRendering = 0;

	} );

	colorLayer.scene.add( ambientLight );
	colorLayer.scene.add( directionalLight );
	colorLayer.depthTexture = new THREE.DepthTexture();
	colorLayer.depthTexture.type = THREE.UnsignedIntType;
	colorLayer.triangleLimit = 1500000;
	colorLayer.geometryLimit = 1500;
	colorLayer.camera.position.set( 2.5, 0.75, 1.9 );

	// colorLayer.clipPlane = this.clipPlane;

	colorLayer.isVisible = () => model && model.geometryLoaded;
	renderer.addLayer( colorLayer );

	const highlightLayer = new ModelRenderLayer( model, 1, 'highlight' );
	highlightLayer.modelToWorld.copy( modelToWorld );
	highlightLayer.clearColor = backgroundColor;
	highlightLayer.clearAlpha = 0.5;
	highlightLayer.camera = colorLayer.camera;
	highlightLayer.triangleLimit = colorLayer.triangleLimit;
	highlightLayer.geometryLimit = colorLayer.geometryLimit;
	// highlightLayer.clipPlane = this.clipPlane;


	let selectedMap = {};
	let fullSelectedMap = {};
	let getSelectedNode = () => null;
	function setSelectionMap( map ) {

		selectedMap = map;
		fullSelectedMap = model.mapToFullMap( selectedMap );

		const nodes = model.sortedGeometryNodes;
		const ids = [];
		const task = ( function* () {

			// return the non-visible nodes first so the highlight for the visible nodes is more prominent
			for ( const n of nodes ) {

				if ( ( ! n.cached.enabledInTree || ! n.cached.visibleInTree ) && fullSelectedMap[ n.id ] ) {

					ids.push( n );
					yield null;

				}

			}

			for ( const n of nodes ) {

				if ( n.cached.enabledInTree && n.cached.visibleInTree && fullSelectedMap[ n.id ] ) {

					ids.push( n );
					yield null;

				}

			}

		} )();

		let done = false;
		getSelectedNode = i => {

			while ( ! done && i >= ids.length ) done = task.next().done;
			return ids[ i ];

		};

		highlightLayer.redraw();

	}

	model.listen( 'preprocess-complete', () => setSelectionMap( selectedMap ) );

	const lightMat = new THREE.MeshBasicMaterial( { color: 'rgb(65%, 75%, 70%)', opacity: 0.35, transparent: true, depthTest: false } );
	const highlightMat = new THREE.MeshBasicMaterial( { color: 'rgb(0%, 100%, 50%)', opacity: 0.35, transparent: true, depthTest: false } );
	highlightLayer.getMaterial = n => ( ! n.cached.enabledInTree || ! n.cached.visibleInTree ? lightMat : highlightMat );
	highlightLayer.getNodeToRender = ( model, i ) => getSelectedNode( i );
	highlightLayer.isVisible = () => {

		//see comment above for this._layers.color.isVisible
		if ( ! model || ! model.geometryLoaded ) return false;

		const isHighlighting = fullSelectedMap && Object.keys( fullSelectedMap ).length > 0;

		return isHighlighting;

	};

	renderer.addLayer( highlightLayer );

	const annotationLayer = new AnnotationRenderLayer( 2, 'annotations' );
	annotationLayer.prerender = () => annotationLayer.depthTexture = colorLayer.depthTexture;
	annotationLayer.scene.add( new THREE.AmbientLight( 0xffffff ) );
	annotationLayer.camera = colorLayer.camera;
	annotationLayer.model = model;
	renderer.addLayer( annotationLayer );

	// Click Events
	// keep track of whether or not the mouse moved
	// from mouse down to mouse up and don't fire a
	// raycast if it did to avoid accidental clicks
	// when rotation
	let downPos = { x: 0, y: 0 };
	let moved = false;

	const getRaycast = e => {

		const xnorm = ( e.offsetX / element.offsetWidth ) * 2 - 1;
		const ynorm = - ( e.offsetY / element.offsetHeight ) * 2 + 1;
		const mouse = new THREE.Vector2( xnorm, ynorm );

		return ModelCaster.raycast( model, colorLayer.camera, mouse, colorLayer.modelToWorld );

	};

	element.addEventListener( 'pointerdown', e => {

		downPos = { x: e.pageX, y: e.pageY };
		moved = false;

	} );

	element.addEventListener( 'pointermove', e => {

		// mouse move was getting called on some machines
		// even though it didn't seem like it should, so
		// we check this more explicitly
		moved = moved || ( downPos.x !== e.pageX && downPos.y !== e.pageY );

	} );

	element.addEventListener( 'pointerup', e => {


		if ( e.which !== 1 && e.which !== 3 || ! model.preprocessDone ) return;

		// If the mouse moved before being released, then don't
		// cast a ray. Otherwise we will register a click while the
		// user is using the trackball controls
		if ( moved ) return;

		e.preventDefault();

		const { hitNode, hitMesh, hitPoint, hitNormal } = getRaycast( e );

		if ( e.which === 1 ) {

			if ( hitNode ) setSelectionMap( { [ hitNode.id ]: true } );
			else setSelectionMap( {} );

		} else if ( e.which === 3 ) {

			if ( hitPoint ) {

				annotationLayer.annotationState.poi.norm.copy( hitNormal );
				annotationLayer.annotationState.poi.pos.copy( hitPoint );
				annotationLayer.annotationState.poi.hide = false;

			} else {

				annotationLayer.annotationState.poi.hide = true;

			}

		}

	} );

	const gui = new GUI();
	gui.add( { lod }, 'lod', [ 0, 1, 2 ] ).onChange( v => {

		params.set( 'lod', v );
		window.location.search = '?' + params.toString();

	} );

	gui.add( colorLayer, 'triangleLimit', 5000, 10000000, 5000 ).name( 'triangleBudget' ).onChange( v => {

		highlightLayer.triangleLimit = colorLayer.triangleLimit;

	} );

	gui.add( colorLayer, 'geometryLimit', 100, 10000, 100 ).name( 'geometryBudget' ).onChange( v => {

		highlightLayer.geometryLimit = colorLayer.geometryLimit;

	} );

	// removing until orbit controls does not broadcast change every frame
	gui.add( { camera: 'perspective' }, 'camera', [ 'perspective', 'orthographic' ] ).onChange( v => {

		if ( v === 'perspective' ) colorLayer.camera.toPerspective();
		if ( v === 'orthographic' ) colorLayer.camera.toOrthographic();

		colorLayer.redraw();
		highlightLayer.redraw();

	} );

}
