'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  FolderOpen, 
  Save, 
  ChevronLeft, 
  ChevronRight, 
  Image as ImageIcon, 
  FileText, 
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Grid,
  Edit3,
  Download,
  Sparkles,
  Settings2,
  X,
  Terminal,
  Cpu,
  Archive,
  LayoutGrid,
  Maximize2,
  Maximize
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import { motion } from 'motion/react';

interface DatasetItem {
  baseName: string;
  imageHandle?: FileSystemFileHandle;
  textHandle?: FileSystemFileHandle;
  imageFile?: File;
  textFile?: File;
  imageUrl?: string;
  textContent?: string;
  dirHandle?: FileSystemDirectoryHandle;
}

interface AppSettings {
  provider: 'gemini' | 'ollama' | 'openrouter';
  prompt: string;
  ollamaUrl: string;
  ollamaModel: string;
  openRouterKey: string;
  openRouterModel: string;
  geminiKey: string;
}

const DEFAULT_PROMPT = "Write a highly detailed description of this image, optimized for training a text-to-image model or LoRA. Describe the main subject, their appearance, clothing, pose, expression, the background, lighting, and the overall art style or medium. Provide the output as a clean, descriptive text or comma-separated tags, without any conversational filler.";

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'gemini',
  prompt: DEFAULT_PROMPT,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llava',
  openRouterKey: '',
  openRouterModel: 'google/gemini-2.5-flash',
  geminiKey: '',
};

function Thumbnail({ item, onClick, isSelected, onToggleSelect }: { 
  item: DatasetItem, 
  onClick: () => void,
  isSelected: boolean,
  onToggleSelect: (e: React.MouseEvent) => void
}) {
  const [url, setUrl] = useState<string | null>(item.imageUrl || null);
  const isMissingText = !item.textContent || item.textContent.trim() === '';
  
  useEffect(() => {
    if (url) return;
    let isMounted = true;
    
    if (item.imageHandle) {
      item.imageHandle.getFile().then(file => {
        if (isMounted) {
          const objectUrl = URL.createObjectURL(file);
          setUrl(objectUrl);
        }
      });
    } else if (item.imageFile) {
      Promise.resolve().then(() => {
        if (isMounted) {
          const objectUrl = URL.createObjectURL(item.imageFile!);
          setUrl(objectUrl);
        }
      });
    }
    
    return () => {
      isMounted = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item, url]);

  return (
    <div onClick={onClick} className={`cursor-pointer border transition-all bg-paper flex flex-col aspect-square relative group rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 ${isSelected ? 'border-brand ring-2 ring-brand/50' : 'border-ink/5 hover:border-brand'}`}>
      <div className="absolute top-2 left-2 z-20">
        <button onClick={onToggleSelect} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? 'bg-brand border-brand' : 'bg-white/50 border-ink/20'}`}>
           {isSelected && <div className="w-2 h-2 bg-white rounded-full" />}
        </button>
      </div>
      {isMissingText && (
        <div className="absolute top-2 right-2 z-20 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
          NO TXT
        </div>
      )}
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={url} alt={item.baseName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-ink/10">
          <ImageIcon className="w-8 h-8 animate-pulse" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-paper/90 backdrop-blur-md p-3 text-[10px] tracking-wider truncate text-ink/70 border-t border-ink/5 font-bold uppercase z-10">
        {item.baseName}
      </div>
      {(item.textHandle || item.textFile) && (
        <div className="absolute top-0 right-0 bg-brand text-white p-2 shadow-lg rounded-bl-2xl z-10">
          <FileText className="w-3.5 h-3.5" />
        </div>
      )}
    </div>
  );
}

export default function DatasetAnnotator() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [items, setItems] = useState<DatasetItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [currentText, setCurrentText] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  
  const [viewMode, setViewMode] = useState<'overview' | 'editor' | 'grid'>('overview');
  const [datasets, setDatasets] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const itemsPerPage = 24;

  const [showSettings, setShowSettings] = useState(true);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const abortControllerRef = useRef<AbortController | null>(null);

  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [isReplacing, setIsReplacing] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'done'>('all');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [pendingHandle, setPendingHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // Derived items based on search and filter
  const filteredItems = items.filter(item => {
    const matchesSearch = item.baseName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         (item.textContent?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);
    const hasText = !!(item.textHandle || item.textFile);
    const matchesFilter = filterStatus === 'all' || 
                         (filterStatus === 'pending' && !hasText) || 
                         (filterStatus === 'done' && hasText);
    return matchesSearch && matchesFilter;
  });

  // Stats calculation
  const stats = {
    total: items.length,
    done: items.filter(i => i.textHandle || i.textFile).length,
    pending: items.length - items.filter(i => i.textHandle || i.textFile).length,
    percent: items.length > 0 ? Math.round((items.filter(i => i.textHandle || i.textFile).length / items.length) * 100) : 0
  };

  // Export Logic
  const exportDataset = (format: 'jsonl' | 'csv') => {
    let content = '';
    if (format === 'jsonl') {
      content = items.map(i => JSON.stringify({ file: i.baseName, caption: i.textContent || '' })).join('\n');
    } else {
      content = 'file,caption\n' + items.map(i => `"${i.baseName.replace(/"/g, '""')}","${(i.textContent || '').replace(/"/g, '""')}"`).join('\n');
    }
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dataset_export.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllTexts = async () => {
    const zip = new JSZip();
    let hasContent = false;
    items.forEach(item => {
      if (item.textContent) {
        zip.file(`${item.baseName}.txt`, item.textContent);
        hasContent = true;
      }
    });
    
    if (!hasContent) {
      setError("No annotations to download.");
      return;
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = "annotations.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Load settings on mount
  useEffect(() => {
    const saved = localStorage.getItem('dataset_annotator_settings');
    if (saved) {
      try {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(saved) });
      } catch (e) {
        console.error("Failed to parse settings", e);
      }
    }
  }, []);

  // Save settings
  const updateSettings = (updates: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    localStorage.setItem('dataset_annotator_settings', JSON.stringify(newSettings));
    if (dirHandle) {
        saveProject(dirHandle, newSettings);
    }
  };



  const getDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
    if (!('showDirectoryPicker' in window)) {
      // Fallback for browsers without showDirectoryPicker
      // Note: This is a simplified fallback, it might not work as expected for all cases.
      // The user will have to select files manually.
      return null;
    }
    // @ts-ignore
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  };

  const countImagesRecursive = async (handle: FileSystemDirectoryHandle): Promise<number> => {
    let count = 0;
    // @ts-ignore
    for await (const entry of handle.values()) {
      if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
        count++;
      } else if (entry.kind === 'directory') {
        count += await countImagesRecursive(entry as FileSystemDirectoryHandle);
      }
    }
    return count;
  };

  const loadDatasetRecursive = async (handle: FileSystemDirectoryHandle, fileMap: Map<string, { image?: FileSystemFileHandle, text?: FileSystemFileHandle }>) => {
    // @ts-ignore
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        const match = entry.name.match(/^(.*)\.(png|jpg|jpeg|webp|txt)$/i);
        if (match) {
          const baseName = match[1];
          const ext = match[2].toLowerCase();
          
          if (!fileMap.has(baseName)) fileMap.set(baseName, {});
          const item = fileMap.get(baseName)!;
          
          if (ext === 'txt') {
            item.text = entry as FileSystemFileHandle;
          } else {
            item.image = entry as FileSystemFileHandle;
          }
        }
      } else if (entry.kind === 'directory') {
        await loadDatasetRecursive(entry as FileSystemDirectoryHandle, fileMap);
      }
    }
  };

  const getFirstImageRecursive = async (handle: FileSystemDirectoryHandle): Promise<string | null> => {
    // @ts-ignore
    for await (const entry of handle.values()) {
      if (entry.kind === 'file' && entry.name.match(/\.(png|jpg|jpeg|webp)$/i)) {
        const file = await (entry as FileSystemFileHandle).getFile();
        return URL.createObjectURL(file);
      } else if (entry.kind === 'directory') {
        const result = await getFirstImageRecursive(entry as FileSystemDirectoryHandle);
        if (result) return result;
      }
    }
    return null;
  };

  const processDirectory = async (handle: FileSystemDirectoryHandle, loadSession: boolean) => {
    setDirHandle(handle);
    setIsFallbackMode(false);
    
    if (loadSession) {
        const projectSettings = await loadProject(handle);
        if (projectSettings) {
            setSettings(prev => ({...prev, ...projectSettings}));
        }
    }

    const subDirs: {name: string, handle: FileSystemDirectoryHandle, count: number, previewUrl: string | null}[] = [];
    
    // @ts-ignore
    for await (const entry of handle.values()) {
      if (entry.kind === 'directory') {
        const count = await countImagesRecursive(entry as FileSystemDirectoryHandle);
        const previewUrl = await getFirstImageRecursive(entry as FileSystemDirectoryHandle);
        subDirs.push({name: entry.name, handle: entry as FileSystemDirectoryHandle, count, previewUrl});
      }
    }
    
    if (subDirs.length > 0) {
      setDatasets(subDirs);
      setViewMode('overview');
    } else {
      // No subdirectories, scan for images directly
      await handleLoadDataset(handle);
    }
  };

  const handleOpenMainDirectory = async () => {
    setError(null);
    
    try {
      const handle = await getDirectoryHandle();
      if (!handle) {
        setError("Directory picker not supported in this browser.");
        return;
      }
      
      // Check for session
      const projectSettings = await loadProject(handle);
      if (projectSettings) {
          setPendingHandle(handle);
          setShowSessionPrompt(true);
          return;
      }
      
      await processDirectory(handle, false);
      
    } catch (err: any) {
      console.error(err);
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to open directory.');
      }
    }
  };

  const loadDatasetFromFiles = async (files: File[]) => {
      const fileMap = new Map<string, { image?: File, text?: File }>();
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const match = file.name.match(/^(.*)\.(png|jpg|jpeg|webp|txt)$/i);
        if (match) {
          const baseName = match[1];
          const ext = match[2].toLowerCase();
          
          if (!fileMap.has(baseName)) fileMap.set(baseName, {});
          const item = fileMap.get(baseName)!;
          
          if (ext === 'txt') {
            item.text = file;
          } else {
            item.image = file;
          }
        }
      }
      
      const newItems: DatasetItem[] = [];
      for (const [baseName, handles] of fileMap.entries()) {
        if (handles.image) {
          newItems.push({
            baseName,
            imageFile: handles.image,
            textFile: handles.text
          });
        }
      }
      
      const sortedItems = newItems.sort((a, b) => a.baseName.localeCompare(b.baseName));
      setItems(sortedItems);
      
      if (sortedItems.length > 0) {
        setViewMode('grid');
        setCurrentPage(1);
        setSelectedIndex(-1);
      }
  };

  const handleOpenIndividualDataset = async () => {
    setError(null);
    
    if (!('showDirectoryPicker' in window)) {
        const input = document.createElement('input');
        input.type = 'file';
        // @ts-ignore
        input.webkitdirectory = true;
        // @ts-ignore
        input.directory = true;
        input.multiple = true;
        
        input.onchange = async (e) => {
            const files = (e.target as HTMLInputElement).files;
            if (!files) return;
            setIsFallbackMode(true);
            await loadDatasetFromFiles(Array.from(files));
        };
        input.click();
        return;
    }

    try {
        const handle = await getDirectoryHandle();
        if (!handle) {
            setError("Directory picker not supported in this browser.");
            return;
        }
        await handleLoadDataset(handle);
    } catch (err: any) {
        console.error(err);
        if (err.name !== 'AbortError') {
          setError(err.message || 'Failed to open directory.');
        }
    }
  };

  const handleLoadDataset = async (handle: FileSystemDirectoryHandle) => {
      const fileMap = new Map<string, { image?: FileSystemFileHandle, text?: FileSystemFileHandle }>();
      
      await loadDatasetRecursive(handle, fileMap);
      
      const newItems: DatasetItem[] = [];
      for (const [baseName, handles] of fileMap.entries()) {
        if (handles.image) {
          newItems.push({
            baseName,
            imageHandle: handles.image,
            textHandle: handles.text,
            dirHandle: handle
          });
        }
      }
      
      const sortedItems = newItems.sort((a, b) => a.baseName.localeCompare(b.baseName));
      setItems(sortedItems);
      setDirHandle(handle);
      
      if (sortedItems.length > 0) {
        setViewMode('grid');
        setCurrentPage(1);
        setSelectedIndex(-1);
      }
  };

  const selectItem = async (index: number, currentItems: DatasetItem[] = items) => {
    if (index < 0 || index >= currentItems.length) return;
    
    const item = currentItems[index];
    setSelectedIndex(index);
    setHasUnsavedChanges(false);
    
    try {
      if (!item.imageUrl) {
        if (item.imageHandle) {
          const file = await item.imageHandle.getFile();
          item.imageUrl = URL.createObjectURL(file);
        } else if (item.imageFile) {
          item.imageUrl = URL.createObjectURL(item.imageFile);
        }
      }
      
      if (item.textContent === undefined) {
        if (item.textHandle) {
          const file = await item.textHandle.getFile();
          item.textContent = await file.text();
        } else if (item.textFile) {
          item.textContent = await item.textFile.text();
        } else {
          item.textContent = '';
        }
      }
      
      setCurrentText(item.textContent || '');
      
      const newItems = [...currentItems];
      newItems[index] = item;
      setItems(newItems);
    } catch (err: any) {
      console.error("Error loading item details:", err);
      setError(`Failed to load files for ${item.baseName}`);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCurrentText(e.target.value);
    setHasUnsavedChanges(true);
  };

  const getBase64 = async (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const saveProject = async (handle: FileSystemDirectoryHandle, settings: any) => {
    try {
      const fileHandle = await handle.getFileHandle('.annotator-project.json', { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(settings, null, 2));
      await writable.close();
    } catch (err) {
      console.error("Error saving project:", err);
    }
  };

  const renderOverview = () => {
    return (
      <div className="p-6 h-full flex flex-col">
        <h2 className="text-2xl font-bold mb-4">Datasets</h2>
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-3 gap-4">
            {datasets.map(dataset => (
              <button
                key={dataset.name}
                onClick={() => handleLoadDataset(dataset.handle)}
                className="p-4 border rounded-lg hover:bg-gray-100 flex flex-col items-start gap-2"
              >
                {dataset.previewUrl && (
                  <img src={dataset.previewUrl} alt={dataset.name} className="w-full h-32 object-cover rounded" />
                )}
                <span className="font-bold">{dataset.name}</span>
                <span className="text-xs text-gray-500">{dataset.count} images</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const loadProject = async (handle: any) => {
    try {
      console.log("Loading project from handle:", handle);
      const fileHandle = await handle.getFileHandle('.annotator-project.json');
      console.log("Found file handle:", fileHandle);
      const file = await fileHandle.getFile();
      const content = await file.text();
      console.log("File content:", content);
      return JSON.parse(content);
    } catch (err) {
      console.log("Error loading project:", err);
      return null;
    }
  };

  const startBatchGeneration = async () => {
    if (items.length === 0) return;
    setIsBatchGenerating(true);
    setBatchProgress({ current: 0, total: items.length });
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      for (let i = 0; i < items.length; i++) {
        if (signal.aborted) {
          throw new Error('Batch generation cancelled.');
        }
        
        const item = items[i];
        setBatchProgress({ current: i + 1, total: items.length });
        
        let file: File;
        if (item.imageHandle) {
          file = await item.imageHandle.getFile();
        } else if (item.imageFile) {
          file = item.imageFile;
        } else {
          continue;
        }

        const base64Data = await getBase64(file);
        const mimeType = file.type || 'image/jpeg';
        let generatedText = '';

        if (settings.provider === 'gemini') {
          const apiKey = settings.geminiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
          if (!apiKey) throw new Error("Gemini API Key is missing. Add it in Settings.");
          
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
              parts: [
                { inlineData: { mimeType, data: base64Data } },
                { text: settings.prompt }
              ]
            }
          });
          generatedText = response.text || '';

        } else if (settings.provider === 'ollama') {
          const res = await fetch(`${settings.ollamaUrl.replace(/\/$/, '')}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: settings.ollamaModel || 'llava',
              prompt: settings.prompt,
              images: [base64Data],
              stream: false
            }),
            signal
          });
          if (!res.ok) throw new Error(`Ollama Error: ${res.statusText}`);
          const data = await res.json();
          generatedText = data.response;

        } else if (settings.provider === 'openrouter') {
          if (!settings.openRouterKey) throw new Error("OpenRouter API Key is missing. Add it in Settings.");
          
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${settings.openRouterKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: settings.openRouterModel || 'google/gemini-2.5-flash',
              messages: [{
                role: 'user',
                content: [
                  { type: 'text', text: settings.prompt },
                  { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
                ]
              }]
            }),
            signal
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(`OpenRouter Error: ${errData.error?.message || res.statusText}`);
          }
          const data = await res.json();
          generatedText = data.choices?.[0]?.message?.content || '';
        }

        if (generatedText) {
          let existingText = item.textContent;
          if (existingText === undefined) {
            if (item.textHandle) {
              const textFile = await item.textHandle.getFile();
              existingText = await textFile.text();
            } else if (item.textFile) {
              existingText = await item.textFile.text();
            } else {
              existingText = '';
            }
          }
          
          const newText = existingText.trim() 
            ? `${existingText.trim()}\n\n${generatedText.trim()}`
            : generatedText.trim();
            
          item.textContent = newText;
          
          if (isFallbackMode) {
            const blob = new Blob([newText], { type: 'text/plain' });
            item.textFile = new File([blob], `${item.baseName}.txt`, { type: 'text/plain' });
          } else if (item.dirHandle || dirHandle) {
            const activeDirHandle = item.dirHandle || dirHandle;
            let textHandle = item.textHandle;
            if (!textHandle) {
              // @ts-ignore
              textHandle = await activeDirHandle.getFileHandle(`${item.baseName}.txt`, { create: true });
              item.textHandle = textHandle;
            }
            // @ts-ignore
            const writable = await textHandle.createWritable();
            await writable.write(newText);
            await writable.close();
          }
          
          setItems(prev => {
            const next = [...prev];
            next[i] = item;
            return next;
          });
          
          if (selectedIndex === i) {
            setCurrentText(newText);
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Batch generation cancelled.') {
        console.log('Batch generation cancelled');
      } else {
        console.error("Batch generation failed:", err);
        setError(`Batch Error: ${err.message}`);
      }
    } finally {
      setIsBatchGenerating(false);
      abortControllerRef.current = null;
    }
  };

  const cancelBatchGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleFindReplace = async () => {
    if (!findText) return;
    setIsReplacing(true);
    setError(null);
    
    try {
      let replaceCount = 0;
      const updatedItems = [...items];
      
      for (let i = 0; i < updatedItems.length; i++) {
        const item = updatedItems[i];
        
        let existingText = item.textContent;
        if (existingText === undefined) {
          if (item.textHandle) {
            const textFile = await item.textHandle.getFile();
            existingText = await textFile.text();
          } else if (item.textFile) {
            existingText = await item.textFile.text();
          } else {
            existingText = '';
          }
        }
        
        if (existingText && existingText.includes(findText)) {
          const newText = existingText.split(findText).join(replaceText);
          item.textContent = newText;
          replaceCount++;
          
          if (isFallbackMode) {
            const blob = new Blob([newText], { type: 'text/plain' });
            item.textFile = new File([blob], `${item.baseName}.txt`, { type: 'text/plain' });
          } else if (item.dirHandle || dirHandle) {
            const activeDirHandle = item.dirHandle || dirHandle;
            let textHandle = item.textHandle;
            if (!textHandle) {
              // @ts-ignore
              textHandle = await activeDirHandle.getFileHandle(`${item.baseName}.txt`, { create: true });
              item.textHandle = textHandle;
            }
            // @ts-ignore
            const writable = await textHandle.createWritable();
            await writable.write(newText);
            await writable.close();
          }
          
          if (selectedIndex === i) {
            setCurrentText(newText);
          }
        }
      }
      
      setItems(updatedItems);
      setShowFindReplace(false);
      
      // Simple custom notification instead of alert
      const notification = document.createElement('div');
      notification.className = 'fixed bottom-6 right-6 bg-[#0A091E] border border-[rgb(var(--theme-color)_/_0.5)] text-white px-6 py-4 rounded-xl shadow-2xl z-50 font-mono text-sm flex items-center gap-3 animate-in slide-in-from-bottom-5';
      notification.innerHTML = `<svg class="w-5 h-5 text-[rgb(var(--theme-color))]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Replaced in ${replaceCount} files.`;
      document.body.appendChild(notification);
      setTimeout(() => {
        notification.classList.add('animate-out', 'fade-out', 'slide-out-to-bottom-5');
        setTimeout(() => notification.remove(), 300);
      }, 3000);
      
    } catch (err: any) {
      console.error("Find/Replace failed:", err);
      setError(`Find/Replace Error: ${err.message}`);
    } finally {
      setIsReplacing(false);
    }
  };

  const generateCaption = async () => {
    if (selectedIndex === -1) return;
    const item = items[selectedIndex];
    
    setIsGenerating(true);
    setError(null);
    
    try {
      let file: File;
      if (item.imageHandle) {
        file = await item.imageHandle.getFile();
      } else if (item.imageFile) {
        file = item.imageFile;
      } else {
        throw new Error("No image file found to analyze.");
      }

      const base64Data = await getBase64(file);
      const mimeType = file.type || 'image/jpeg';
      let generatedText = '';

      if (settings.provider === 'gemini') {
        const apiKey = settings.geminiKey || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) throw new Error("Gemini API Key is missing. Add it in Settings.");
        
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
            parts: [
              { inlineData: { mimeType, data: base64Data } },
              { text: settings.prompt }
            ]
          }
        });
        generatedText = response.text || '';

      } else if (settings.provider === 'ollama') {
        const res = await fetch(`${settings.ollamaUrl.replace(/\/$/, '')}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.ollamaModel || 'llava',
            prompt: settings.prompt,
            images: [base64Data],
            stream: false
          })
        });
        if (!res.ok) throw new Error(`Ollama Error: ${res.statusText}. Ensure CORS is configured (OLLAMA_ORIGINS="*").`);
        const data = await res.json();
        generatedText = data.response;

      } else if (settings.provider === 'openrouter') {
        if (!settings.openRouterKey) throw new Error("OpenRouter API Key is missing. Add it in Settings.");
        
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${settings.openRouterKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: settings.openRouterModel || 'google/gemini-2.5-flash',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: settings.prompt },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
              ]
            }]
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(`OpenRouter Error: ${errData.error?.message || res.statusText}`);
        }
        const data = await res.json();
        generatedText = data.choices?.[0]?.message?.content || '';
      }

      if (generatedText) {
        const newText = currentText.trim() 
          ? `${currentText.trim()}\n\n${generatedText.trim()}`
          : generatedText.trim();
          
        setCurrentText(newText);
        setHasUnsavedChanges(true);
      }
      
    } catch (err: any) {
      console.error("Failed to generate caption:", err);
      setError(`AI Error: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const saveCurrentText = useCallback(async () => {
    if (selectedIndex === -1) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      const item = items[selectedIndex];
      
      if (isFallbackMode) {
        const blob = new Blob([currentText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.baseName}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        item.textContent = currentText;
        item.textFile = new File([blob], `${item.baseName}.txt`, { type: 'text/plain' });
      } else {
        const activeDirHandle = item.dirHandle || dirHandle;
        if (!activeDirHandle) throw new Error("Directory handle not found");
        let textHandle = item.textHandle;
        
        if (!textHandle) {
          // @ts-ignore
          textHandle = await activeDirHandle.getFileHandle(`${item.baseName}.txt`, { create: true });
          item.textHandle = textHandle;
        }
        
        // @ts-ignore
        const writable = await textHandle.createWritable();
        await writable.write(currentText);
        await writable.close();
        
        item.textContent = currentText;
      }
      
      const newItems = [...items];
      newItems[selectedIndex] = item;
      setItems(newItems);
      setHasUnsavedChanges(false);
      
    } catch (err: any) {
      console.error("Failed to save:", err);
      setError(`Failed to save file: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }, [selectedIndex, items, isFallbackMode, currentText, dirHandle]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowShortcuts(false);
        setShowFindReplace(false);
        setShowLightbox(false);
      }
      if (e.key === '?' && (e.target as HTMLElement).tagName !== 'TEXTAREA' && (e.target as HTMLElement).tagName !== 'INPUT') {
        setShowShortcuts(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentText();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [currentText, hasUnsavedChanges, saveCurrentText]);

  const saveAndNext = async () => {
    await saveCurrentText();
    if (selectedIndex < items.length - 1) {
      selectItem(selectedIndex + 1);
    } else {
      setViewMode('grid');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentText();
    }
  };

  const activeItem = selectedIndex >= 0 ? items[selectedIndex] : null;

  const [themeColor, setThemeColor] = useState<string>('255 99 33'); // Default #FF6321
  const [themeFont, setThemeFont] = useState<string>('font-sans');

  useEffect(() => {
    if (activeItem?.imageUrl) {
      const img = new window.Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 50;
          canvas.height = 50;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, 50, 50);
            const data = ctx.getImageData(0, 0, 50, 50).data;
            
            let rSum = 0, gSum = 0, bSum = 0, count = 0;
            let fallbackR = 0, fallbackG = 0, fallbackB = 0;

            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i+1], b = data[i+2];
              fallbackR += r; fallbackG += g; fallbackB += b;

              const max = Math.max(r, g, b);
              const min = Math.min(r, g, b);
              const saturation = max === 0 ? 0 : (max - min) / max;

              if (saturation > 0.2 && max > 50 && max < 240) {
                rSum += r; gSum += g; bSum += b;
                count++;
              }
            }

            let finalR, finalG, finalB;
            if (count > 0) {
              finalR = Math.round(rSum / count);
              finalG = Math.round(gSum / count);
              finalB = Math.round(bSum / count);
            } else {
              const total = data.length / 4;
              finalR = Math.round(fallbackR / total);
              finalG = Math.round(fallbackG / total);
              finalB = Math.round(fallbackB / total);
            }

            // Adjust for readability on cream background
            const luminance = (0.299 * finalR + 0.587 * finalG + 0.114 * finalB) / 255;
            if (luminance > 0.7) {
              const factor = 0.7 / luminance;
              finalR = Math.round(finalR * factor);
              finalG = Math.round(finalG * factor);
              finalB = Math.round(finalB * factor);
            }
            
            setThemeColor(`${finalR} ${finalG} ${finalB}`);
          }
        } catch (e) {
          setThemeColor('255 99 33');
        }
      };
      img.onerror = () => {
        setThemeColor('255 99 33');
      };
      img.src = activeItem.imageUrl;
    } else {
      setThemeColor('255 99 33');
    }
  }, [activeItem?.imageUrl]);

  const renderGrid = () => {
    const totalPages = Math.ceil(items.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const currentItems = items.slice(startIndex, startIndex + itemsPerPage);

    return (
      <div className="flex-1 flex flex-col min-h-0 bg-paper/50">
        <div className="h-14 border-b border-ink/10 flex items-center justify-between px-6 bg-paper/80 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <h2 className="text-[11px] uppercase tracking-wider text-ink/60 font-serif italic">
              Dataset Overview <span className="text-brand ml-2 font-sans not-italic font-bold">[{items.length} ITEMS]</span>
            </h2>
            <div className="flex items-center gap-1 bg-ink/5 p-1 rounded-full border border-ink/10 ml-2">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-full transition-all ${viewMode === 'grid' ? 'bg-white text-brand shadow-sm' : 'text-ink/30 hover:text-ink'}`}
                title="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button 
                onClick={() => setViewMode('editor')}
                className={`p-1.5 rounded-full transition-all ${viewMode === 'editor' ? 'bg-white text-brand shadow-sm' : 'text-ink/30 hover:text-ink'}`}
                title="Editor View"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {selectedItems.size > 0 && (
            <button
              onClick={() => {
                // TODO: Implement bulk AI annotation
                alert(`Generating AI annotations for ${selectedItems.size} items.`);
              }}
              className="bg-brand text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-full hover:bg-brand/90 transition-all shadow-lg"
            >
              Bulk AI Annotation ({selectedItems.size})
            </button>
          )}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="text-ink/40 hover:text-brand disabled:opacity-30 transition-colors p-1 rounded-md hover:bg-ink/5"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-[11px] text-ink/60 font-mono tracking-wider">
              PAGE {currentPage}/{totalPages || 1}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || totalPages === 0}
              className="text-ink/40 hover:text-brand disabled:opacity-30 transition-colors p-1 rounded-md hover:bg-ink/5"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-ink/20 space-y-4">
              <FolderOpen className="w-16 h-16 stroke-[1px]" />
              <div className="text-sm font-serif italic">
                Awaiting directory mount...
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-8">
            {currentItems.map((item, idx) => (
              <Thumbnail 
                key={item.baseName} 
                item={item} 
                onClick={() => {
                  selectItem(startIndex + idx);
                }} 
                isSelected={selectedItems.has(item.baseName)}
                onToggleSelect={(e) => {
                  e.stopPropagation();
                  const newSelected = new Set(selectedItems);
                  if (newSelected.has(item.baseName)) {
                    newSelected.delete(item.baseName);
                  } else {
                    newSelected.add(item.baseName);
                  }
                  setSelectedItems(newSelected);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ '--theme-color': themeColor } as React.CSSProperties} className={`flex h-screen w-full bg-paper text-ink overflow-hidden selection:bg-brand/20 selection:text-brand transition-all duration-700 ease-in-out ${themeFont}`}>
      
      {/* LEFT SIDEBAR: File Explorer */}
      <div className="w-72 bg-paper border-r border-ink/10 flex flex-col z-10 shadow-2xl">
        <div className="p-6 border-b border-ink/10">
          <div className="flex items-center justify-between mb-6">
            <h1 
              onClick={() => datasets.length > 0 ? setViewMode('overview') : setViewMode('grid')}
              className="text-xl font-serif italic tracking-tight flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center shadow-lg shadow-brand/20">
                <Terminal className="w-4 h-4 text-white" />
              </div>
              Annotator<span className="text-brand not-italic">.</span>
            </h1>
            <button 
              onClick={() => setShowShortcuts(true)}
              className="p-1.5 text-ink/30 hover:text-brand transition-colors"
              title="Keyboard Shortcuts (?)"
            >
              <Cpu className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleOpenMainDirectory}
              className="w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand/90 text-white py-2.5 px-4 font-bold text-xs rounded-full transition-all shadow-lg shadow-brand/20 active:scale-[0.98] uppercase tracking-widest"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Mount Main Directory
            </button>
            <button
              onClick={handleOpenIndividualDataset}
              className="w-full flex items-center justify-center gap-2 bg-ink/10 hover:bg-ink/20 text-ink py-2.5 px-4 font-bold text-xs rounded-full transition-all shadow-lg shadow-ink/5 active:scale-[0.98] uppercase tracking-widest"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Mount Dataset
            </button>
          </div>
          
          {items.length > 0 && (
            <div className="mt-4 space-y-4">
              {/* Stats Dashboard */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-ink/5 p-2 rounded-xl border border-ink/5">
                  <div className="text-[8px] uppercase tracking-widest text-ink/40 font-bold mb-0.5">Progress</div>
                  <div className="text-xs font-bold text-brand">{stats.percent}%</div>
                </div>
                <div className="bg-ink/5 p-2 rounded-xl border border-ink/5">
                  <div className="text-[8px] uppercase tracking-widest text-ink/40 font-bold mb-0.5">Pending</div>
                  <div className="text-xs font-bold text-ink/60">{stats.pending}</div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => exportDataset('jsonl')}
                    className="flex-1 flex items-center justify-center gap-2 bg-white border border-ink/10 hover:border-brand/30 text-ink py-2 px-3 font-bold text-[9px] rounded-full transition-all shadow-sm uppercase tracking-widest"
                  >
                    <Download className="w-3 h-3" />
                    JSONL
                  </button>
                  <button
                    onClick={() => exportDataset('csv')}
                    className="flex-1 flex items-center justify-center gap-2 bg-white border border-ink/10 hover:border-brand/30 text-ink py-2 px-3 font-bold text-[9px] rounded-full transition-all shadow-sm uppercase tracking-widest"
                  >
                    <Download className="w-3 h-3" />
                    CSV
                  </button>
                </div>

                <button
                  onClick={() => setShowFindReplace(true)}
                  className="w-full flex items-center justify-center gap-2 bg-white border border-ink/10 hover:border-brand/30 text-ink py-2 px-4 font-bold text-[9px] rounded-full transition-all shadow-sm uppercase tracking-widest"
                >
                  <Edit3 className="w-3 h-3" />
                  Find & Replace
                </button>
                
                {!isBatchGenerating ? (
                  <button
                    onClick={startBatchGeneration}
                    className="w-full flex items-center justify-center gap-2 bg-white border border-ink/10 hover:border-brand/30 text-ink py-2 px-4 font-bold text-[9px] rounded-full transition-all shadow-sm uppercase tracking-widest"
                  >
                    <Sparkles className="w-3 h-3 text-brand" />
                    Batch Generate
                  </button>
                ) : (
                  <div className="w-full flex flex-col gap-2 bg-brand/5 border border-brand/20 p-2.5 rounded-xl">
                    <div className="flex justify-between items-center text-[9px] text-brand font-bold uppercase tracking-widest">
                      <span>Generating...</span>
                      <span>{batchProgress.current} / {batchProgress.total}</span>
                    </div>
                    <div className="w-full bg-ink/5 rounded-full h-1 overflow-hidden">
                      <div 
                        className="bg-brand h-1 rounded-full transition-all duration-300" 
                        style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                    <button
                      onClick={cancelBatchGeneration}
                      className="w-full py-1 text-brand/60 hover:text-brand text-[8px] font-bold uppercase tracking-widest transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {datasets.length > 0 && (
            <button
              onClick={() => setViewMode('overview')}
              className={`w-full flex items-center justify-center gap-2 py-2 mb-4 text-[9px] font-bold rounded-full transition-all uppercase tracking-widest ${viewMode === 'overview' ? 'bg-white text-ink shadow-md' : 'text-ink/40 hover:text-ink'}`}
            >
              <LayoutGrid className="w-3 h-3" />
              Overview
            </button>
          )}
          
          {items.length > 0 && (
            <div className="flex p-1 border border-ink/10 rounded-full bg-ink/5">
              <button
                onClick={() => setViewMode('grid')}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[9px] font-bold rounded-full transition-all uppercase tracking-widest ${viewMode === 'grid' ? 'bg-white text-ink shadow-md' : 'text-ink/40 hover:text-ink'}`}
              >
                <Grid className="w-3 h-3" />
                Grid
              </button>
              <button
                onClick={() => {
                  if (selectedIndex === -1 && items.length > 0) selectItem(0);
                  setViewMode('editor');
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-[9px] font-bold rounded-full transition-all uppercase tracking-widest ${viewMode === 'editor' ? 'bg-white text-ink shadow-md' : 'text-ink/40 hover:text-ink'}`}
              >
                <Edit3 className="w-3 h-3" />
                Edit Mode
              </button>
            </div>
          )}
        </div>

        {/* Search & Filter Bar */}
        {items.length > 0 && (
          <div className="p-4 border-b border-ink/10 bg-paper/30 space-y-3">
            <div className="relative">
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files or content..."
                className="w-full bg-white border border-ink/10 rounded-full py-1.5 pl-8 pr-4 text-[10px] focus:outline-none focus:border-brand transition-all"
              />
              <ImageIcon className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 text-ink/20" />
            </div>
            <div className="flex p-0.5 bg-ink/5 rounded-full">
              {(['all', 'pending', 'done'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`flex-1 py-1 text-[8px] font-bold uppercase tracking-widest rounded-full transition-all ${filterStatus === status ? 'bg-white text-brand shadow-sm' : 'text-ink/30 hover:text-ink/60'}`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        )}
        
        <div className="flex-1 overflow-y-auto py-4 space-y-1 custom-scrollbar">
          {filteredItems.length === 0 ? (
            <div className="text-center p-8 text-ink/20 text-[10px] font-serif italic mt-10">
              {items.length === 0 ? 'No files loaded' : 'No matches found'}
            </div>
          ) : (
            filteredItems.map((item) => {
              const idx = items.indexOf(item);
              return (
                <button
                  key={item.baseName}
                  onClick={() => {
                    selectItem(idx);
                  }}
                  className={`w-[calc(100%-32px)] mx-4 text-left px-4 py-2.5 text-[11px] flex items-center justify-between group transition-all rounded-xl ${
                    idx === selectedIndex
                      ? 'bg-brand/10 text-brand font-bold border border-brand/20' 
                      : 'hover:bg-ink/5 text-ink/60 border border-transparent'
                  }`}
                >
                  <span className="truncate pr-2">{item.baseName}</span>
                  {(item.textHandle || item.textFile) ? (
                    <FileText className={`w-3.5 h-3.5 shrink-0 ${idx === selectedIndex ? 'text-brand' : 'text-brand/40'}`} />
                  ) : (
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${idx === selectedIndex ? 'bg-brand' : 'bg-ink/10'}`} />
                  )}
                </button>
              );
            })
          )}
        </div>
        
        {items.length > 0 && (
          <div className="p-6 border-t border-ink/10 bg-paper/50 space-y-4">
            <div className="text-[10px] text-ink/40 flex justify-between uppercase tracking-widest font-bold">
              <span>{items.length} Files</span>
              <span className="text-brand">{items.filter(i => i.textHandle || i.textFile).length} Annotated</span>
            </div>
            <button
              onClick={downloadAllTexts}
              className="w-full flex items-center justify-center gap-2 bg-brand text-white py-2 px-4 font-bold text-[9px] rounded-full transition-all shadow-md hover:shadow-lg hover:bg-brand/90 active:scale-[0.98] uppercase tracking-widest"
            >
              <Archive className="w-3 h-3" />
              Download all TXTs (ZIP)
            </button>
          </div>
        )}
      </div>

      {/* MIDDLE & RIGHT PANES */}
      <div className="flex-1 flex flex-row min-w-0 relative">
        
        {/* Error Banner */}
        {error && (
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 backdrop-blur-md text-white px-5 py-3.5 rounded-xl font-mono text-xs flex items-center gap-3 shadow-2xl max-w-lg w-full border border-red-400/50">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <div className="flex-1 truncate">{error}</div>
            <button onClick={() => setError(null)} className="hover:bg-white/20 p-1 rounded-md transition-colors"><X className="w-4 h-4"/></button>
          </div>
        )}

        {/* CENTER PANE */}
        <div className="flex-1 flex flex-col min-w-0 relative border-r border-ink/10">
          {viewMode === 'overview' ? (
            renderOverview()
          ) : items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-ink/10 font-serif italic tracking-widest">
              <Cpu className="w-24 h-24 mb-6 opacity-10" />
              <p>System Idle. Mount directory to begin.</p>
            </div>
          ) : viewMode === 'grid' ? (
            renderGrid()
          ) : !activeItem ? (
            <div className="flex-1 flex flex-col items-center justify-center text-ink/10 font-serif italic tracking-widest">
              <p>Select target for annotation</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-w-0 bg-paper/50 h-full">
              
              {/* CENTER PANE: Image Viewer */}
              <div className="h-14 border-b border-ink/10 flex items-center justify-between px-6 bg-paper/80 backdrop-blur-md">
                <div className="flex items-center gap-4">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-brand font-bold">
                    {activeItem.baseName}
                  </span>
                  <div className="flex items-center gap-1 bg-ink/5 p-1 rounded-full border border-ink/10 ml-2">
                    <button 
                      onClick={() => setViewMode('grid')}
                      className={`p-1.5 rounded-full transition-all ${viewMode === 'grid' ? 'bg-white text-brand shadow-sm' : 'text-ink/30 hover:text-ink'}`}
                      title="Grid View"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => setViewMode('editor')}
                      className={`p-1.5 rounded-full transition-all ${viewMode === 'editor' ? 'bg-white text-brand shadow-sm' : 'text-ink/30 hover:text-ink'}`}
                      title="Editor View"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button onClick={() => selectItem(selectedIndex - 1)} disabled={selectedIndex === 0} className="text-ink/40 hover:text-brand disabled:opacity-30 p-1 rounded-md hover:bg-ink/5 transition-colors">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <span className="text-[11px] text-ink/60 font-mono tracking-wider">
                    {selectedIndex + 1}/{items.length}
                  </span>
                  <button onClick={() => selectItem(selectedIndex + 1)} disabled={selectedIndex === items.length - 1} className="text-ink/40 hover:text-brand disabled:opacity-30 p-1 rounded-md hover:bg-ink/5 transition-colors">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 p-12 flex items-center justify-center relative overflow-hidden">
                {activeItem.imageUrl ? (
                  <div className="relative group max-h-[500px] w-full flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={activeItem.imageUrl} 
                      alt={activeItem.baseName}
                      className="max-w-full max-h-[300px] object-contain shadow-2xl border border-ink/5 rounded-3xl z-10 bg-white p-4"
                    />
                    <button 
                      onClick={() => setShowLightbox(true)}
                      className="absolute top-4 right-4 bg-ink/80 hover:bg-brand backdrop-blur-md text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-2xl z-20 active:scale-90"
                      title="Full View"
                    >
                      <Maximize className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="animate-pulse text-ink/20 font-serif italic text-sm uppercase tracking-wider">Loading asset...</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANE: AI Settings & Editor */}
        {items.length > 0 && (
          <div className="w-[400px] bg-paper flex flex-col z-10 shadow-2xl border-l border-ink/10">
            
            {/* AI Controls Header */}
            <div className="p-6 border-b border-ink/10 bg-paper/50">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] uppercase tracking-widest text-ink/40 font-bold flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-brand" />
                  AI Assistant
                </h3>
                <button 
                  onClick={() => setShowSettings(!showSettings)}
                  className={`p-1.5 border transition-all rounded-full ${showSettings ? 'border-brand text-brand bg-brand/5' : 'border-ink/10 text-ink/40 hover:border-brand/30 hover:text-brand hover:bg-brand/5'}`}
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {showSettings && (
                <div className="space-y-4 animate-in slide-in-from-top-2">
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Provider</label>
                    <select 
                      value={settings.provider}
                      onChange={(e) => updateSettings({ provider: e.target.value as any })}
                      className="w-full bg-white border border-ink/10 text-ink text-xs p-2.5 rounded-xl focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all appearance-none font-bold"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="ollama">Ollama (Local)</option>
                    </select>
                  </div>

                  {settings.provider === 'gemini' && (
                    <div className="space-y-1.5">
                      <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">API Key <span className="text-ink/20 lowercase font-normal">(Optional if env var set)</span></label>
                      <input 
                        type="password"
                        value={settings.geminiKey}
                        onChange={(e) => updateSettings({ geminiKey: e.target.value })}
                        placeholder="AIzaSy..."
                        className="w-full bg-white border border-ink/10 text-ink text-xs p-2.5 rounded-xl focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono"
                      />
                    </div>
                  )}

                  {settings.provider === 'openrouter' && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">API Key</label>
                        <input 
                          type="password"
                          value={settings.openRouterKey}
                          onChange={(e) => updateSettings({ openRouterKey: e.target.value })}
                          placeholder="sk-or-..."
                          className="w-full bg-white border border-ink/10 text-ink text-xs p-2.5 rounded-xl focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Model</label>
                        <input 
                          type="text"
                          value={settings.openRouterModel}
                          onChange={(e) => updateSettings({ openRouterModel: e.target.value })}
                          placeholder="google/gemini-2.0-flash-001"
                          className="w-full bg-white border border-ink/10 text-ink text-xs p-2.5 rounded-xl focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {settings.provider === 'ollama' && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Ollama URL</label>
                        <input 
                          type="text"
                          value={settings.ollamaUrl}
                          onChange={(e) => updateSettings({ ollamaUrl: e.target.value })}
                          placeholder="http://localhost:11434"
                          className="w-full bg-white border border-ink/10 text-ink text-xs p-2.5 rounded-xl focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">Model</label>
                        <input 
                          type="text"
                          value={settings.ollamaModel}
                          onChange={(e) => updateSettings({ ollamaModel: e.target.value })}
                          placeholder="llama3"
                          className="w-full bg-white border border-ink/10 text-ink text-xs p-2.5 rounded-xl focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all font-mono"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase tracking-widest text-ink/40 font-bold">System Prompt</label>
                    <textarea 
                      value={settings.prompt}
                      onChange={(e) => updateSettings({ prompt: e.target.value })}
                      className="w-full bg-white border border-ink/10 text-ink text-xs p-3 rounded-xl h-24 resize-none focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 transition-all custom-scrollbar font-serif italic"
                    />
                  </div>
                </div>
              )}
            </div>

            {activeItem ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="px-6 py-4 border-b border-ink/10 flex items-center justify-between bg-paper/30">
                  <div className="text-[9px] uppercase tracking-widest text-ink/40 font-bold flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-brand/60" />
                    {activeItem.baseName}.txt
                  </div>
                  {hasUnsavedChanges && (
                    <div className="w-2 h-2 bg-brand rounded-full animate-pulse shadow-lg shadow-brand/40" title="Unsaved changes" />
                  )}
                </div>

                {viewMode === 'grid' && activeItem.imageUrl && (
                  <div className="px-6 pt-4">
                    <div className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={activeItem.imageUrl} 
                        alt="Thumbnail" 
                        className="w-full h-32 object-cover rounded-xl border border-ink/10 shadow-sm transition-all group-hover:h-48 cursor-pointer"
                        onClick={() => setShowLightbox(true)}
                      />
                      <div className="absolute inset-0 bg-ink/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl pointer-events-none">
                        <span className="text-[8px] text-white font-bold uppercase tracking-widest">Click for Full View</span>
                      </div>
                    </div>
                  </div>
                )}
                
                <textarea
                  value={currentText}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter annotation data..."
                  className={`flex-1 w-full bg-white border border-ink/10 p-6 rounded-xl resize-none focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 transition-all text-sm leading-relaxed custom-scrollbar font-serif italic`}
                  spellCheck={false}
                />
                
                {/* Action Bar */}
                <div className="p-6 border-t border-ink/10 bg-paper/50 flex flex-col gap-4">
                  <div className="flex justify-between text-[9px] font-bold uppercase tracking-widest text-ink/30">
                    <span>{currentText.length} Characters</span>
                    <span>⌘S to Save</span>
                  </div>
                  <button
                    onClick={generateCaption}
                    disabled={isGenerating || !activeItem}
                    className="w-full py-2.5 px-4 bg-brand/5 text-brand hover:bg-brand/10 border border-brand/20 font-bold text-[10px] rounded-full transition-all disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] uppercase tracking-widest"
                  >
                    {isGenerating ? (
                      <div className="w-3.5 h-3.5 border-2 border-brand/20 border-t-brand rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {isGenerating ? 'Processing...' : 'AI Generate'}
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={saveCurrentText}
                      disabled={isSaving || (!hasUnsavedChanges && !isFallbackMode)}
                      className="flex-1 py-2.5 border border-ink/10 text-ink/60 hover:bg-ink/5 font-bold text-[10px] rounded-full transition-all disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] uppercase tracking-widest"
                    >
                      {isFallbackMode ? <Download className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                      {isFallbackMode ? 'DL' : 'Save'}
                    </button>
                    <button
                      onClick={saveAndNext}
                      className="flex-[2] py-2.5 bg-ink text-white hover:bg-ink/90 font-bold text-[10px] rounded-full shadow-xl transition-all flex items-center justify-center gap-2 active:scale-[0.98] uppercase tracking-widest"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-brand" />
                      {isFallbackMode ? 'DL & Next' : 'Save & Next'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-ink/20 font-serif italic text-xs p-12 text-center space-y-4">
                <FileText className="w-12 h-12 opacity-10" />
                <p>Select an image in the grid to edit its annotation</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Find & Replace Modal */}
      {showFindReplace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-md">
          <div className="bg-paper border border-ink/10 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-ink/10 flex justify-between items-center bg-paper/50">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-ink flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-brand" />
                Find & Replace
              </h3>
              <button onClick={() => setShowFindReplace(false)} className="text-ink/30 hover:text-ink transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Find</label>
                <input 
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="e.g. A Man"
                  className="w-full bg-white border border-ink/10 text-ink text-sm p-3 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 transition-all font-serif italic"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Replace With</label>
                <input 
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="w-full bg-white border border-ink/10 text-ink text-sm p-3 rounded-xl focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/20 transition-all font-serif italic"
                />
              </div>
            </div>
            <div className="p-6 border-t border-ink/10 bg-paper/50 flex justify-end gap-4">
              <button 
                onClick={() => setShowFindReplace(false)}
                className="px-6 py-2 text-[10px] font-bold text-ink/40 hover:text-ink transition-colors uppercase tracking-widest"
              >
                Cancel
              </button>
              <button 
                onClick={handleFindReplace}
                disabled={!findText || isReplacing}
                className="px-6 py-2 bg-brand hover:bg-brand/90 text-white text-[10px] font-bold rounded-full transition-colors disabled:opacity-50 flex items-center gap-2 uppercase tracking-widest shadow-lg shadow-brand/20"
              >
                {isReplacing ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Replace All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shortcuts Modal */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 backdrop-blur-md">
          <div className="bg-paper border border-ink/10 rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95">
            <div className="p-6 border-b border-ink/10 flex justify-between items-center bg-paper/50">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-ink flex items-center gap-2">
                <Cpu className="w-4 h-4 text-brand" />
                Keyboard Shortcuts
              </h3>
              <button onClick={() => setShowShortcuts(false)} className="text-ink/30 hover:text-ink transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-8 space-y-4">
              {[
                { key: '⌘ + S', desc: 'Save current annotation' },
                { key: '⌘ + Enter', desc: 'Save and move to next' },
                { key: '?', desc: 'Toggle this help menu' },
                { key: 'Esc', desc: 'Close any open modal' },
                { key: '↑ / ↓', desc: 'Navigate file list' },
              ].map(item => (
                <div key={item.key} className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">{item.desc}</span>
                  <kbd className="bg-ink/5 border border-ink/10 px-2 py-1 rounded text-[10px] font-mono text-brand">{item.key}</kbd>
                </div>
              ))}
            </div>
            <div className="p-6 bg-ink/5 text-center">
              <button 
                onClick={() => setShowShortcuts(false)}
                className="text-[10px] font-bold uppercase tracking-widest text-brand hover:underline"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Overlay */}
      {showLightbox && activeItem && (
        <div 
          className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/90 backdrop-blur-xl p-8 md:p-16 animate-in fade-in duration-300"
          onClick={() => setShowLightbox(false)}
        >
          <button 
            onClick={() => setShowLightbox(false)}
            className="absolute top-8 right-8 text-white/50 hover:text-white transition-colors z-[210] p-2 hover:bg-white/10 rounded-full"
          >
            <X className="w-8 h-8" />
          </button>
          
          <div 
            className="relative w-full h-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {activeItem.imageUrl ? (
              <motion.img 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                src={activeItem.imageUrl} 
                alt={activeItem.baseName}
                className="max-w-full max-h-full object-contain shadow-2xl rounded-2xl border border-white/10"
              />
            ) : (
              <div className="text-white/20 font-serif italic">Loading image...</div>
            )}
            
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-12 text-white/60 font-mono text-[10px] uppercase tracking-widest bg-white/5 px-6 py-2 rounded-full backdrop-blur-md border border-white/10">
              {activeItem.baseName}
            </div>
          </div>
        </div>
      )}

      {showSessionPrompt && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-ink/50 backdrop-blur-sm p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full">
            <h2 className="text-lg font-bold mb-2">Session Found</h2>
            <p className="text-sm text-ink/60 mb-6">A previous session was found in this directory. Do you want to load it?</p>
            <div className="flex gap-3">
              <button 
                onClick={() => { setShowSessionPrompt(false); if (pendingHandle) processDirectory(pendingHandle, false); }}
                className="flex-1 py-2 rounded-full bg-ink/10 text-ink font-bold text-xs uppercase tracking-widest hover:bg-ink/20"
              >
                No
              </button>
              <button 
                onClick={() => { setShowSessionPrompt(false); if (pendingHandle) processDirectory(pendingHandle, true); }}
                className="flex-1 py-2 rounded-full bg-brand text-white font-bold text-xs uppercase tracking-widest hover:bg-brand/90"
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
