import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  Trash2,
  Download,
  AlertTriangle,
  X,
  FileJson,
  Eye,
  Copy,
  CheckCircle,
  Send,
  Terminal,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { generatePrompt, generateFlowJson } from "../utils/flowGenerator";

export default function SiteList() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();
  const [sites, setSites] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal states
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    id: number | null;
  }>({ isOpen: false, id: null });
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    message: string;
  }>({ isOpen: false, message: "" });
  const [viewModal, setViewModal] = useState<{ isOpen: boolean; site: any }>({
    isOpen: false,
    site: null,
  });
  const [endpointModal, setEndpointModal] = useState<{
    isOpen: boolean;
    site: any;
  }>({ isOpen: false, site: null });

  const [copiedJsonId, setCopiedJsonId] = useState<number | null>(null);
  const [isCopying, setIsCopying] = useState(false);

  const [endpointUrl, setEndpointUrl] = useState("");
  const [endpointMethod, setEndpointMethod] = useState("POST");
  const [authToken, setAuthToken] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [processLogs, setProcessLogs] = useState<
    { time: string; message: string; type: "info" | "success" | "error" }[]
  >([]);
  const [endpointResult, setEndpointResult] = useState<{
    success?: boolean;
    error?: string;
  } | null>(null);

  const fetchSites = async () => {
    try {
      const res = await fetch("/api/sites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        logout();
        navigate("/login");
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Failed to fetch sites: ${res.status} ${text}`);
      }
      const data = await res.json();
      setSites(data);
    } catch (error) {
      console.error("Error fetching sites:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, [token]);

  const confirmDelete = async () => {
    if (!deleteModal.id) return;

    try {
      const res = await fetch(`/api/sites/${deleteModal.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        logout();
        navigate("/login");
        return;
      }
      setDeleteModal({ isOpen: false, id: null });
      fetchSites();
    } catch (error) {
      setDeleteModal({ isOpen: false, id: null });
      setAlertModal({ isOpen: true, message: "Erro ao excluir análise" });
    }
  };

  const handleDownloadJson = async (filename: string) => {
    try {
      const res = await fetch(`/api/analyze/download/${filename}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        logout();
        navigate("/login");
        return;
      }
      if (!res.ok) throw new Error("Falha ao baixar arquivo");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download error:", error);
      setAlertModal({
        isOpen: true,
        message: "Erro ao baixar o arquivo JSON.",
      });
    }
  };

  const handleCopyJsonToClipboard = async (site: any) => {
    setIsCopying(true);
    try {
      const res = await fetch(`/api/analyze/download/${site.slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        logout();
        navigate("/login");
        return;
      }
      if (!res.ok) throw new Error("Falha ao obter JSON");
      const data = await res.json();
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedJsonId(site.id);
      setTimeout(() => setCopiedJsonId(null), 2000);
    } catch (error) {
      console.error("Copy error:", error);
      setAlertModal({ isOpen: true, message: "Erro ao copiar o JSON." });
    } finally {
      setIsCopying(false);
    }
  };

  const [showFlowJson, setShowFlowJson] = useState(false);
  const [generatedFlowJson, setGeneratedFlowJson] = useState<any>(null);
  const [payloadType, setPayloadType] = useState<"flow" | "data">("flow");

  const handleSendToEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endpointUrl || !endpointModal.site) return;

    setIsSending(true);
    setProcessLogs([]);
    setEndpointResult(null);

    const addLog = (
      message: string,
      type: "info" | "success" | "error" = "info",
    ) => {
      setProcessLogs((prev) => [
        ...prev,
        { time: new Date().toLocaleTimeString(), message, type },
      ]);
    };

    try {
      addLog("Buscando dados completos da análise...", "info");
      const res = await fetch(
        `/api/analyze/download/${endpointModal.site.slug}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (res.status === 401 || res.status === 403) {
        logout();
        navigate("/login");
        return;
      }
      if (!res.ok) throw new Error("Falha ao obter JSON da análise");
      const data = await res.json();
      addLog("Dados da análise obtidos com sucesso.", "success");

      addLog("Gerando prompt Mobile First e JSON do Fluxo...", "info");
      const promptText = generatePrompt(
        data,
        endpointModal.site.map_link || "",
      );
      const flowJson = generateFlowJson(promptText, endpointModal.site.name, endpointModal.site.id, data);
      setGeneratedFlowJson(flowJson);
      addLog("JSON do Fluxo gerado com sucesso.", "success");

      const finalPayload = payloadType === "flow" ? flowJson : data;
      const payloadLabel =
        payloadType === "flow" ? "JSON do Fluxo" : "Dados da Análise";

      addLog(
        `Enviando ${payloadLabel} para o endpoint: ${endpointUrl}...`,
        "info",
      );
      addLog(
        `Payload que será enviado:\n${JSON.stringify(finalPayload, null, 2)}`,
        "info"
      );
      const endpointRes = await fetch("/api/proxy-webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          url: endpointUrl,
          payload: finalPayload,
          method: endpointMethod,
          authToken: authToken,
        }),
      });

      if (endpointRes.status === 401 || endpointRes.status === 403) {
        logout();
        navigate("/login");
        return;
      }

      if (endpointRes.ok) {
        const resData = await endpointRes.json();
        if (resData.success) {
          setEndpointResult({ success: true });
          addLog(
            "JSON do Fluxo enviado com sucesso para o endpoint.",
            "success",
          );
        } else {
          const errorMsg = resData.error || "Erro desconhecido no proxy";
          setEndpointResult({ success: false, error: errorMsg });
          addLog(`Erro ao enviar para o endpoint: ${errorMsg}`, "error");
        }
      } else {
        const resData = await endpointRes.json().catch(() => ({}));
        const errorMsg = resData.error || `Erro HTTP: ${endpointRes.status}`;
        setEndpointResult({ success: false, error: errorMsg });
        addLog(`Erro ao enviar para o endpoint: ${errorMsg}`, "error");
      }

      addLog("Processo de envio finalizado.", "info");
    } catch (error: any) {
      console.error("Endpoint error:", error);
      const errorMsg = error.message || "Falha na conexão com o endpoint";
      setEndpointResult({ success: false, error: errorMsg });
      addLog(`Falha na conexão com o endpoint: ${errorMsg}`, "error");
    } finally {
      setIsSending(false);
    }
  };

  const renderLogs = () => {
    if (processLogs.length === 0) return null;
    return (
      <div className="mt-6 bg-zinc-900 rounded-xl p-4 border border-zinc-800 font-mono text-xs shadow-inner overflow-hidden">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-zinc-800">
          <Terminal className="w-4 h-4 text-zinc-400" />
          <span className="text-zinc-300 font-semibold uppercase tracking-wider">
            Logs do Processo
          </span>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
          {processLogs.map((log, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-zinc-500 shrink-0">[{log.time}]</span>
              <span
                className={`whitespace-pre-wrap ${
                  log.type === "success"
                    ? "text-emerald-400"
                    : log.type === "error"
                      ? "text-red-400"
                      : "text-blue-300"
                }`}
              >
                {log.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* View Details Modal */}
      {viewModal.isOpen && viewModal.site && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 border-b pb-4">
              <h3 className="text-xl font-semibold text-zinc-900">
                Detalhes da Análise
              </h3>
              <button
                onClick={() => setViewModal({ isOpen: false, site: null })}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-zinc-500">
                  Nome da Empresa
                </h4>
                <p className="mt-1 text-base text-zinc-900">
                  {viewModal.site.name}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-zinc-500">
                    Telefone
                  </h4>
                  <p className="mt-1 text-base text-zinc-900">
                    {viewModal.site.phone || "N/A"}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-zinc-500">Cidade</h4>
                  <p className="mt-1 text-base text-zinc-900">
                    {viewModal.site.city || "N/A"}
                  </p>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-500">Endereço</h4>
                <p className="mt-1 text-base text-zinc-900">
                  {viewModal.site.address || "N/A"}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-500">Descrição</h4>
                <p className="mt-1 text-base text-zinc-900">
                  {viewModal.site.description || "N/A"}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-500">Serviços</h4>
                <p className="mt-1 text-base text-zinc-900">
                  {viewModal.site.services || "N/A"}
                </p>
              </div>
              {viewModal.site.map_link && (
                <div>
                  <h4 className="text-sm font-medium text-zinc-500">
                    Link do Google Maps
                  </h4>
                  <a
                    href={viewModal.site.map_link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 text-base text-emerald-600 hover:underline break-all"
                  >
                    {viewModal.site.map_link}
                  </a>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-zinc-500">
                    Data de Criação
                  </h4>
                  <p className="mt-1 text-base text-zinc-900">
                    {new Date(viewModal.site.created_at).toLocaleDateString(
                      "pt-BR",
                    )}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-zinc-500">
                    Expira em
                  </h4>
                  <p
                    className={`mt-1 text-base font-medium ${new Date(viewModal.site.expires_at) < new Date() ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {new Date(viewModal.site.expires_at).toLocaleDateString(
                      "pt-BR",
                    )}
                  </p>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-500">
                  Arquivo JSON
                </h4>
                <div className="mt-1 flex items-center gap-2">
                  <FileJson className="w-4 h-4 text-emerald-600" />
                  <span className="text-base text-zinc-900">
                    {viewModal.site.slug}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t pt-4">
              <button
                onClick={() => {
                  setEndpointModal({ isOpen: true, site: viewModal.site });
                  setViewModal({ isOpen: false, site: null });
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Enviar para Endpoint
              </button>
              <button
                onClick={() => handleCopyJsonToClipboard(viewModal.site)}
                disabled={isCopying}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-2"
              >
                {copiedJsonId === viewModal.site.id ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copiedJsonId === viewModal.site.id
                  ? "Copiado!"
                  : "Copiar JSON"}
              </button>
              <button
                onClick={() => handleDownloadJson(viewModal.site.slug)}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Baixar JSON
              </button>
              <button
                onClick={() => setViewModal({ isOpen: false, site: null })}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Endpoint Modal */}
      {endpointModal.isOpen && endpointModal.site && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 border-b pb-4">
              <h3 className="text-xl font-semibold text-zinc-900">
                Enviar para Endpoint
              </h3>
              <button
                onClick={() => {
                  setEndpointModal({ isOpen: false, site: null });
                  setProcessLogs([]);
                  setEndpointResult(null);
                  setEndpointUrl("");
                  setAuthToken("");
                }}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="mb-6">
              <p className="text-sm text-zinc-600 mb-4">
                Você está prestes a gerar o Fluxo JSON para{" "}
                <strong>{endpointModal.site.name}</strong> e enviá-lo para um
                endpoint.
              </p>
              <form onSubmit={handleSendToEndpoint}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-zinc-900 mb-2">
                    Tipo de Dados para Enviar
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPayloadType("flow")}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${payloadType === "flow" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300"}`}
                    >
                      <FileJson className="w-6 h-6 mb-1" />
                      <span className="text-xs font-bold">Fluxo Completo</span>
                      <span className="text-[10px] opacity-70">
                        Nodes + Edges
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayloadType("data")}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${payloadType === "data" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300"}`}
                    >
                      <CheckCircle className="w-6 h-6 mb-1" />
                      <span className="text-xs font-bold">Apenas Dados</span>
                      <span className="text-[10px] opacity-70">
                        Nome, Tel, Endereço...
                      </span>
                    </button>
                  </div>
                </div>

                <label className="block text-sm font-medium text-zinc-900 mb-1">
                  URL do Endpoint
                </label>
                <div className="flex gap-3">
                  <select
                    value={endpointMethod}
                    onChange={(e) => setEndpointMethod(e.target.value)}
                    className="focus:ring-blue-500 focus:border-blue-500 block sm:text-sm border-zinc-300 rounded-md shadow-sm px-3 py-2 border bg-white"
                  >
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="GET">GET</option>
                  </select>
                  <input
                    type="url"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="https://seu-endpoint.com/api/upload"
                    required
                    className="flex-1 focus:ring-blue-500 focus:border-blue-500 block sm:text-sm border-zinc-300 rounded-md shadow-sm px-3 py-2 border bg-white"
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-zinc-900 mb-1">
                    Token de Autenticação (Opcional)
                  </label>
                  <input
                    type="text"
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    placeholder="Bearer token ou API Key"
                    className="w-full focus:ring-blue-500 focus:border-blue-500 block sm:text-sm border-zinc-300 rounded-md shadow-sm px-3 py-2 border bg-white"
                  />
                  <p className="mt-1 text-[10px] text-zinc-500">
                    Se o seu servidor exigir um cabeçalho Authorization ou
                    x-api-key, insira-o aqui.
                  </p>
                </div>

                <div className="mt-6 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (endpointModal.site) {
                        const promptText = generatePrompt(
                          endpointModal.site,
                          endpointModal.site.map_link || "",
                        );
                        const flowJson = generateFlowJson(
                          promptText,
                          endpointModal.site.name,
                          endpointModal.site.id,
                          endpointModal.site
                        );
                        setGeneratedFlowJson(flowJson);
                        setShowFlowJson(true);
                      }
                    }}
                    className="inline-flex justify-center items-center py-2 px-4 border border-zinc-300 shadow-sm text-sm font-medium rounded-md text-zinc-700 bg-white hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <FileJson className="w-4 h-4 mr-2 text-blue-600" />
                    Ver JSON do Fluxo
                  </button>
                  <button
                    type="submit"
                    disabled={isSending || !endpointUrl}
                    className="inline-flex justify-center items-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    {isSending ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Enviar
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>

            {endpointResult && (
              <div
                className={`rounded-xl p-4 mb-6 border ${endpointResult.success ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${endpointResult.success ? "bg-emerald-100" : "bg-red-100"}`}
                  >
                    {endpointResult.success ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    )}
                  </div>
                  <div>
                    <h4
                      className={`font-medium text-sm ${endpointResult.success ? "text-emerald-900" : "text-red-900"}`}
                    >
                      {endpointResult.success ? "Sucesso" : "Falha no Envio"}
                    </h4>
                    <p
                      className={`text-xs ${endpointResult.success ? "text-emerald-700" : "text-red-700"}`}
                    >
                      {endpointResult.success
                        ? "O fluxo JSON foi enviado com sucesso para o endpoint configurado."
                        : endpointResult.error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {renderLogs()}

            <div className="mt-6 flex justify-end border-t pt-4">
              <button
                onClick={() => {
                  setEndpointModal({ isOpen: false, site: null });
                  setProcessLogs([]);
                  setEndpointResult(null);
                  setEndpointUrl("");
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flow JSON Preview Modal */}
      {showFlowJson && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/60 p-4">
          <div className="relative w-full max-w-4xl rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 border-b pb-4">
              <div className="flex items-center gap-2">
                <FileJson className="w-5 h-5 text-emerald-600" />
                <h3 className="text-xl font-semibold text-zinc-900">
                  Preview do JSON do Fluxo
                </h3>
              </div>
              <button
                onClick={() => setShowFlowJson(false)}
                className="text-zinc-400 hover:text-zinc-600 p-1"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-zinc-950 rounded-xl p-4 font-mono text-xs text-emerald-400 custom-scrollbar">
              <pre>{JSON.stringify(generatedFlowJson, null, 2)}</pre>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    JSON.stringify(generatedFlowJson, null, 2),
                  );
                  // Could add a temporary toast here
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Copiar JSON
              </button>
              <button
                onClick={() => setShowFlowJson(false)}
                className="rounded-lg bg-zinc-900 px-6 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-900">Aviso</h3>
              <button
                onClick={() => setAlertModal({ isOpen: false, message: "" })}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-zinc-600 mb-6">{alertModal.message}</p>
            <div className="flex justify-end">
              <button
                onClick={() => setAlertModal({ isOpen: false, message: "" })}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto overflow-x-hidden bg-black/50 p-4">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900">
                Excluir Análise
              </h3>
            </div>
            <p className="text-zinc-600 mb-6">
              Tem certeza que deseja excluir esta análise? O arquivo JSON será
              apagado.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteModal({ isOpen: false, id: null })}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-zinc-900">Análises Salvas</h1>
        <Link
          to="/create"
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700"
        >
          Nova Análise
        </Link>
      </div>

      <div className="bg-white shadow rounded-lg overflow-hidden">
        {/* Mobile View */}
        <div className="block sm:hidden">
          <ul className="divide-y divide-zinc-200">
            {sites.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-zinc-500">
                <p className="mb-4">Nenhuma análise realizada ainda.</p>
                <Link
                  to="/create"
                  className="text-emerald-600 font-medium hover:underline"
                >
                  Faça sua primeira análise
                </Link>
              </li>
            ) : (
              sites.map((site: any) => (
                <li key={site.id} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 truncate">
                        {site.name}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {site.city}
                      </p>
                    </div>
                    <div className="ml-2 flex-shrink-0 flex">
                      <p className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-emerald-100 text-emerald-800">
                        {new Date(site.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <div className="flex items-center text-sm text-zinc-500">
                      <FileJson className="flex-shrink-0 mr-1.5 h-4 w-4 text-emerald-600" />
                      <span className="truncate max-w-[150px]">
                        {site.slug}
                      </span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => setViewModal({ isOpen: true, site })}
                        className="text-blue-600 hover:text-blue-900 flex items-center p-1"
                        title="Ver Detalhes"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDownloadJson(site.slug)}
                        className="text-emerald-600 hover:text-emerald-900 flex items-center p-1"
                        title="Baixar JSON"
                      >
                        <Download className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() =>
                          setDeleteModal({ isOpen: true, id: site.id })
                        }
                        className="text-red-600 hover:text-red-900 flex items-center p-1"
                        title="Excluir"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Desktop View */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Empresa
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Arquivo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Expiração
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Data
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-zinc-200">
              {sites.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center text-sm text-zinc-500"
                  >
                    <p className="mb-4">Nenhuma análise realizada ainda.</p>
                    <Link
                      to="/create"
                      className="text-emerald-600 font-medium hover:underline"
                    >
                      Faça sua primeira análise
                    </Link>
                  </td>
                </tr>
              ) : (
                sites.map((site: any) => {
                  return (
                    <tr key={site.id} className="hover:bg-zinc-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-zinc-900">
                          {site.name}
                        </div>
                        <div className="text-sm text-zinc-500">{site.city}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <FileJson className="w-4 h-4 text-emerald-600" />
                          <span className="text-sm text-zinc-600">
                            {site.slug}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            new Date(site.expires_at) < new Date()
                              ? "bg-red-100 text-red-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {new Date(site.expires_at).toLocaleDateString(
                            "pt-BR",
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500">
                        {new Date(site.created_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end space-x-3">
                          <button
                            onClick={() => setViewModal({ isOpen: true, site })}
                            className="text-blue-600 hover:text-blue-900 flex items-center"
                            title="Ver Detalhes"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDownloadJson(site.slug)}
                            className="text-emerald-600 hover:text-emerald-900 flex items-center"
                            title="Baixar JSON"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() =>
                              setDeleteModal({ isOpen: true, id: site.id })
                            }
                            className="text-red-600 hover:text-red-900 flex items-center"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
