import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renderScene = vi.fn();
vi.mock("ogl", () => {
  class Renderer { gl: WebGL2RenderingContext & { canvas: HTMLCanvasElement }; constructor() { const canvas=document.createElement("canvas"); this.gl={canvas,clearColor:vi.fn(),enable:vi.fn(),blendFunc:vi.fn(),ONE:1,ONE_MINUS_SRC_ALPHA:2,getExtension:vi.fn(()=>({loseContext:vi.fn()}))} as unknown as WebGL2RenderingContext & {canvas:HTMLCanvasElement}; } setSize(){} render=renderScene; }
  class Triangle { attributes={uv:{}}; }
  class Program { uniforms: Record<string,{value:unknown}>; constructor(_gl:unknown,options:{uniforms:Record<string,{value:unknown}>}){this.uniforms=options.uniforms;} }
  class Mesh { constructor(..._args:unknown[]){} }
  class Color { r=1;g=.7;b=.2;constructor(..._args:unknown[]){} }
  return {Renderer,Triangle,Program,Mesh,Color};
});
import { Aurora } from "./Aurora";

describe("Aurora",()=>{beforeEach(()=>{renderScene.mockReset();Object.defineProperty(window,"matchMedia",{writable:true,value:vi.fn(()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}))});});it("usa quadro estático em movimento reduzido e remove o canvas",()=>{const view=render(<Aurora/>);expect(view.container.querySelectorAll("canvas")).toHaveLength(1);expect(renderScene).toHaveBeenCalledTimes(1);view.unmount();expect(view.container.querySelectorAll("canvas")).toHaveLength(0);});it("não acumula canvases em montagens repetidas",()=>{const first=render(<Aurora/>);first.unmount();const second=render(<Aurora/>);expect(second.container.querySelectorAll("canvas")).toHaveLength(1);});});
