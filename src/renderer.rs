use crate::gl_utils;
use crate::gpu_model::GpuMesh;
use crate::scene::camera::*;
use crate::scene::model::Mesh;
use gl_helpers::*;

use std::fs;

pub struct Renderer {
	meshes: Vec<GpuMesh>,
	pbr_program: GLProgram,
}

impl Renderer {
	pub fn new(
		window_gl: &glutin::WindowedContext<glutin::PossiblyCurrent>,
		logical_size: glutin::dpi::LogicalSize,
	) -> Renderer {
		gl::load_with(|symbol| window_gl.get_proc_address(symbol) as *const _);

		gl_utils::print_opengl_diagnostics();
		gl_set_defaults();
		unsafe {
			gl::FrontFace(gl::CW);
		}
		gl_set_viewport(
			0,
			0,
			logical_size.width as usize,
			logical_size.height as usize,
		);

		let vs_src =
			fs::read_to_string("src/shaders/pbr.vs").expect("Couldn't read the vertex shader :(");
		let fs_src =
			fs::read_to_string("src/shaders/pbr.fs").expect("Couldn't read the fragment shader :(");
		let program = GLProgram::new(&vs_src[..], &fs_src[..]);

		program.get_uniform("time").set_1f(1.0_f32);

		Renderer {
			meshes: Vec::<GpuMesh>::new(),
			pbr_program: program,
		}
	}

	pub fn render(&self, camera: &Camera) {
		gl_set_clear_color(&[0.1, 0.1, 0.1, 1.0]);
		gl_clear(true, true, true);

		self.pbr_program.bind();

		let proj: [f32; 16] = {
			let transmute_me: [[f32; 4]; 4] = camera.projection().into();
			unsafe { std::mem::transmute(transmute_me) }
		};

		let view: [f32; 16] = {
			let transmute_me: [[f32; 4]; 4] = camera.view().into();
			unsafe { std::mem::transmute(transmute_me) }
		};

		self.pbr_program.get_uniform("proj").set_mat4f(&proj);
		self.pbr_program.get_uniform("view").set_mat4f(&view);

		for mesh in &self.meshes {
			for primitive in mesh.primitives() {
				primitive.bind();

				let material = &primitive.material();
				self
					.pbr_program
					.get_uniform("albedo")
					.set_sampler_2d(&material.albedo(), 0);
				self
					.pbr_program
					.get_uniform("metaghness")
					.set_sampler_2d(&material.metaghness(), 1);
				self
					.pbr_program
					.get_uniform("normal")
					.set_sampler_2d(&material.normal(), 2);
				self
					.pbr_program
					.get_uniform("occlusion")
					.set_sampler_2d(&material.occlusion(), 3);

				gl_draw_elements(
					DrawMode::Triangles,
					primitive.count_vertices(),
					IndexKind::UnsignedInt,
					0,
				);
			}
		}
	}

	pub fn submit_mesh(&mut self, mesh: &Mesh) {
		let gpu_mesh = GpuMesh::new(&mesh, &self.pbr_program);
		self.meshes.push(gpu_mesh);
	}
}
