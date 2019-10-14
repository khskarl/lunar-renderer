#version 450
#define MAX_LIGHTS 4

#include <shared.glsl>

uniform vec3 light_direction[MAX_LIGHTS];
uniform vec3 light_position[MAX_LIGHTS];
uniform vec3 light_color[MAX_LIGHTS];
uniform float light_range[MAX_LIGHTS];

uniform int num_lights;

uniform float time;
uniform vec3 camera_position;

uniform vec3 u_volume_center;
uniform vec3 u_volume_scale;
uniform int u_width;

uniform sampler2D albedo_map;
uniform sampler2D metaghness_map;
uniform sampler2D normal_map;
uniform sampler2D occlusion_map;
uniform sampler2D shadow_map;
uniform layout(binding = 5) sampler3D u_radiance;

in vec3 vw_position;
in vec2 v_uv;
in vec4 vl_position;
in mat3 v_TBN;

out vec4 out_color;

float distribution_ggx(vec3 N, vec3 H, float a) {
	float a2     = pow(a, 2.0);
	float NdotH2 = pow(max(dot(N, H), 0.0), 2.0);

	float denom = pow(NdotH2 * (a2 - 1) + 1, 2.0) * PI;

	return a2 / denom;
}

float geometry_smith_ggx(float NdotV, float k) {
	float nom   = NdotV;
	float denom = NdotV * (1.0 - k) + k;

	return nom / denom;
}

float geometry_smith(vec3 N, vec3 V, vec3 L, float k) {
	float NdotV = max(dot(N, V), 0.0);
	float NdotL = max(dot(N, L), 0.0);
	float ggx1 = geometry_smith_ggx(NdotV, k);
	float ggx2 = geometry_smith_ggx(NdotL, k);

	return ggx1 * ggx2;
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
	return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

// vec4 traceCone(sampler3D voxelTexture, vec3 position, vec3 normal, vec3 direction, int steps, float bias, float coneAngle, float coneHeight, float lodOffset) {
// 	vec3 color = vec3(0);
// 	float alpha = 0;
// 	float scale = 1.0 / voxelDim;
// 	vec3 start = position + bias * normal * scale;

// 	for (int i = 0; i < steps && alpha < 0.95; i++) {
// 		float coneRadius = coneHeight * tan(coneAngle / 2.0);
// 		float lod = log2(max (1.0 , 2 * coneRadius ));
// 		vec3 samplePosition = start + coneHeight * direction * scale;

// 		vec4 sampleColor = textureLod(voxelTexture , samplePosition, lod + lodOffset);
// 		float a = 1 - alpha;
// 		color += sampleColor.rgb * a;
// 		alpha += a * sampleColor.a;
// 		coneHeight += coneRadius;
// 	}

// 	return vec4(color , alpha);
// }

vec3 direct_lighting(vec3 Li, vec3 Lc, vec3 albedo, float roughness, float metalness, vec3 normal, float occlusion, vec3 V, vec3 F0) {
	vec3 L = -normalize(Li);
	vec3 H = normalize(V + L);

	vec3 N = normal;
	float NDF = distribution_ggx(N, H, roughness);
	float G   = geometry_smith(N, V, L, roughness);
	vec3 F    = fresnelSchlick(max(dot(H, V), 0.0), F0);
	vec3 radiance = Lc;

	float NdotL = max(dot(N, L), 0.0);

	vec3  nom   = NDF * G * F;
	float denom = 4 * max(dot(N, V), 0.0) * NdotL + 0.001;
	vec3 specular = nom / denom;

	vec3 kS = F;
	vec3 kD = vec3(1.0) - kS;
	kD *= 1.0 - metalness;

	return (kD * albedo / PI + specular) * radiance * NdotL;
}


vec3 radiance_coordinate(vec3 w_position) {
	vec3 volume_corner = u_volume_center - u_volume_scale * 0.505;
	// return ((w_position + u_volume_center) * 6.4) / vec3(64.0);
	// return (w_position + u_volume_center) / vec3(64.0);
	return (((w_position - volume_corner) / (u_volume_scale)));
}

ivec3 coordinate(vec3 w_position) {
	vec3 volume_corner = u_volume_center - u_volume_scale * 0.5;
	// return ((w_position + u_volume_center) * 6.4) / vec3(64.0);
	// return (w_position + u_volume_center) / vec3(64.0);
	return ivec3((((w_position - volume_corner) / u_volume_scale) * (u_width - 0.01)));
}

// vec3 radiance_coordinate(vec3 w_position) {
// 	return (coordinate) / vec3(u_width);
// }

// vec3 texture_3D_coordinate(vec3 w_position) {
// 	return ((w_position + vec3(5.0, 0.0, 5.0)) * 6.4) / vec3(64.0);
// }

void main() {

	vec2 uv = vec2(v_uv.x + sin(time) * 0.001, v_uv.y);

	vec3 albedo = texture(albedo_map, uv).xyz;
	float roughness = texture(metaghness_map, uv).g;
	float metalness = texture(metaghness_map, uv).b;
	vec3 normal = texture(normal_map, uv).rgb;
	normal = normalize(normal * 2.0 - 1.0);
	normal = normalize(v_TBN * normal);

	float occlusion = texture(occlusion_map, uv).r;

	vec3 V = normalize(camera_position - vw_position.xyz);

	vec3 F0 = vec3(0.04);
	F0 = mix(F0, albedo, metalness);

	float shadow = shadow_visilibity_pcf(shadow_map, vl_position);

	vec3 direct = vec3(0.0);
	for(int i = 0; i < min(1, num_lights); i++) {
		vec3 radiance = direct_lighting(
			light_direction[i],
			light_color[i],
			albedo,
			roughness,
			metalness,
			normal,
			occlusion,
			V,
			F0
		);

		direct += radiance * (1.0 - shadow);
	}
	for(int i = 1; i < num_lights; i++) {
		vec3 Li = vw_position.xyz - light_position[i];
		float dist = length(Li);
		float attenuation = 0.1 * dist * dist;

		vec3 radiance = direct_lighting(
			Li,
			light_color[i],
			albedo,
			roughness,
			metalness,
			normal,
			occlusion,
			V,
			F0
		);

		direct += radiance / attenuation;
	}
	vec3 coordinate = radiance_coordinate(vw_position);
	vec3 radiance = texture(u_radiance, coordinate).rgb;
	// vec3 radiance = texelFetch(u_radiance, coordinate, 0).rgb;
	vec3 ambient = albedo * vec3(0.1, 0.07, 0.05) * 0.2 * occlusion;
	vec3 color = (direct + ambient) * u_width * 0.0001 + radiance;
	out_color = vec4(color, 1.0);
}
