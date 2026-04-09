import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { marked } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// 设置pdfjs的工作器
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

// 渲染Markdown并处理KaTeX公式
const renderMarkdownWithKaTeX = (content: string): string => {
  // 首先处理块级公式
  let processedContent = content.replace(/\\\[([\s\S]+?)\\\]/g, (match: string, formula: string) => {
    try {
      return '<div class="katex-display">' + katex.renderToString(formula, {
        throwOnError: false,
        displayMode: true
      }) + '</div>';
    } catch (error) {
      return match;
    }
  });

  // 然后处理行内公式
  processedContent = processedContent.replace(/\$([^$]+)\$/g, (match: string, formula: string) => {
    try {
      return katex.renderToString(formula, {
        throwOnError: false,
        displayMode: false
      });
    } catch (error) {
      return match;
    }
  });

  // 最后使用marked渲染Markdown
  return marked(processedContent);
};

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface SuggestedQuestion {
  id: string;
  question: string;
}

const App: React.FC = () => {
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [pages, setPages] = useState<{ [key: number]: string }>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [selectedText, setSelectedText] = useState<string>('');
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  // 设置相关状态
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [apiEndpoint, setApiEndpoint] = useState<string>('http://127.0.0.1:8000/v1/chat/completions');
  const [apiKey, setApiKey] = useState<string>('7788945');
  const [modelName, setModelName] = useState<string>('gemma-4-26b-a4b-it-4bit');
  const [asrModelName, setAsrModelName] = useState<string>('Qwen3-ASR-1.7B-4bit');

  // 调整大小的逻辑
  const [isResizing, setIsResizing] = useState(false);
  const [chatWidth, setChatWidth] = useState(400);

  // 处理PDF文件上传
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileUrl = URL.createObjectURL(file);

    try {
      const loadingTask = pdfjsLib.getDocument(fileUrl);
      const pdfDoc = await loadingTask.promise;
      
      // 检查是否是之前打开过的文件
      const savedFileName = localStorage.getItem('pdfFileName');
      const savedFileSize = localStorage.getItem('pdfFileSize');
      const savedPage = localStorage.getItem('pdfCurrentPage');
      
      let initialPage = 1;
      if (savedFileName === file.name && savedFileSize === file.size.toString() && savedPage) {
        initialPage = parseInt(savedPage);
        // 确保页码在有效范围内
        initialPage = Math.max(1, Math.min(initialPage, pdfDoc.numPages));
      }

      setPdfDocument(pdfDoc);
      setTotalPages(pdfDoc.numPages);
      setCurrentPage(initialPage);
      setPages({});
      setMessages([]);
      setSelectedText('');
      setSuggestedQuestions([]);

      // 存储文件信息到localStorage
      localStorage.setItem('pdfFileName', file.name);
      localStorage.setItem('pdfFileSize', file.size.toString());
      localStorage.setItem('pdfCurrentPage', initialPage.toString());

      // 直接使用获取的pdfDoc渲染初始页，而不是等待状态更新
      const renderInitialPage = async () => {
        const page = await pdfDoc.getPage(initialPage);
        // 使用默认缩放比例，保持PDF原样渲染
        const scale = 1.5;
        
        // 考虑高DPI屏幕（如视网膜屏）
        const devicePixelRatio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;

        // 调整canvas实际尺寸以适应高DPI屏幕
        canvas.height = viewport.height * devicePixelRatio;
        canvas.width = viewport.width * devicePixelRatio;
        canvas.style.height = `${viewport.height}px`;
        canvas.style.width = `${viewport.width}px`;
        canvas.className = 'pdf-page';

        // 缩放context以匹配设备像素比
        context.scale(devicePixelRatio, devicePixelRatio);

        // 使用默认渲染选项，保持PDF原样渲染
        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };

        await page.render(renderContext).promise;

        // 将canvas转换为base64图片，使用最高质量
        const imageData = canvas.toDataURL('image/png', 1.0);
        setPages(prev => ({ ...prev, [initialPage]: imageData }));

        // 清理
        canvas.remove();
      };

      renderInitialPage();
    } catch (error) {
      console.error('Error loading PDF:', error);
    }
  };

  // 渲染PDF页面
  const renderPage = async (pageNumber: number) => {
    if (!pdfDocument) return;

    try {
      const page = await pdfDocument.getPage(pageNumber);
      // 使用默认缩放比例，保持PDF原样渲染
      const scale = 1.5;
      
      // 考虑高DPI屏幕（如视网膜屏）
      const devicePixelRatio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return;

      // 调整canvas实际尺寸以适应高DPI屏幕
      canvas.height = viewport.height * devicePixelRatio;
      canvas.width = viewport.width * devicePixelRatio;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.width = `${viewport.width}px`;
      canvas.className = 'pdf-page';

      // 缩放context以匹配设备像素比
      context.scale(devicePixelRatio, devicePixelRatio);

      // 使用默认渲染选项，保持PDF原样渲染
      const renderContext = {
        canvasContext: context,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      // 将canvas转换为base64图片，使用最高质量
      const imageData = canvas.toDataURL('image/png', 1.0);
      setPages(prev => ({ ...prev, [pageNumber]: imageData }));

      // 清理
      canvas.remove();
    } catch (error) {
      console.error('Error rendering page:', error);
    }
  };

  // 处理页码变化
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setCurrentPage(newPage);
    // 重置PDF容器的滚动位置到顶部
    if (pdfContainerRef.current) {
      pdfContainerRef.current.scrollTop = 0;
      // 确保PDF容器获得焦点，以便可以继续使用上下键滚动
      pdfContainerRef.current.focus();
    }
    // 更新localStorage中的当前页码
    localStorage.setItem('pdfCurrentPage', newPage.toString());
    if (!pages[newPage]) {
      renderPage(newPage);
    }
  };

  // 处理PDF容器的鼠标点击事件
  useEffect(() => {
    const pdfContainer = pdfContainerRef.current;
    if (!pdfContainer) return;

    // 处理鼠标左键点击，切换到下一页
    const handleMouseDown = (event: MouseEvent) => {
      if (!pdfDocument) return;

      // 左键点击
      if (event.button === 0) {
        if (currentPage < totalPages) {
          handlePageChange(currentPage + 1);
        }
      }
      // 右键点击
      else if (event.button === 2) {
        // 禁用默认右键菜单
        event.preventDefault();
        if (currentPage > 1) {
          handlePageChange(currentPage - 1);
        }
      }
    };

    // 添加鼠标事件监听器
    pdfContainer.addEventListener('mousedown', handleMouseDown);
    // 禁用右键菜单
    pdfContainer.addEventListener('contextmenu', (event) => {
      event.preventDefault();
    });

    return () => {
      // 移除事件监听器
      pdfContainer.removeEventListener('mousedown', handleMouseDown);
      pdfContainer.removeEventListener('contextmenu', (event) => {
        event.preventDefault();
      });
    };
  }, [pdfDocument, currentPage, totalPages, handlePageChange]);

  // 处理文本选择
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      const text = selection.toString().trim();
      setSelectedText(text);
      generateSuggestedQuestions(text);
    } else {
      setSelectedText('');
      setSuggestedQuestions([]);
    }
  };

  // 生成建议问题
  const generateSuggestedQuestions = async (text: string) => {
    if (!text) return;

    setIsGeneratingQuestions(true);
    try {
      // 调用oMLX本地大模型生成问题
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: '你是一个PDF阅读助手，请根据用户选择的文本生成3-4个相关的问题，帮助用户更好地理解文本内容。'
            },
            {
              role: 'user',
              content: `请根据以下文本生成3-4个相关的问题：\n${text}`
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      // 解析生成的问题
      const questions = content
        .split('\n')
        .filter((line: string) => line.trim().match(/^\d+\./))
        .map((line: string, index: number) => ({
          id: (index + 1).toString(),
          question: line.trim().replace(/^\d+\.\s*/, '')
        }));

      setSuggestedQuestions(questions);
    } catch (error) {
      console.error('Error generating questions:', error);
      // 失败时使用默认问题
      const defaultQuestions: SuggestedQuestion[] = [
        { id: '1', question: `这个文本的主要内容是什么？` },
        { id: '2', question: `这段内容与上下文有什么联系？` },
        { id: '3', question: `如何理解这里提到的概念？` },
        { id: '4', question: `这段内容有什么重要意义？` }
      ];
      setSuggestedQuestions(defaultQuestions);
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  // 处理发送消息
  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputMessage,
      sender: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');

    // 检查是否是翻页请求
    const message = inputMessage.toLowerCase();
    let isPageNavigation = false;
    
    // 处理上一页请求
    if (message.includes('上一页') || message.includes('前一页') || message.includes('previous page')) {
      if (pdfDocument && currentPage > 1) {
        handlePageChange(currentPage - 1);
        isPageNavigation = true;
      }
    }
    // 处理下一页请求
    else if (message.includes('下一页') || message.includes('next page')) {
      if (pdfDocument && currentPage < totalPages) {
        handlePageChange(currentPage + 1);
        isPageNavigation = true;
      }
    }
    // 处理跳转到指定页码的请求
    else {
      const pageMatch = message.match(/第(\d+)页|page (\d+)/);
      if (pageMatch && pdfDocument) {
        const pageNum = parseInt(pageMatch[1] || pageMatch[2]);
        if (pageNum >= 1 && pageNum <= totalPages) {
          handlePageChange(pageNum);
          isPageNavigation = true;
        }
      }
    }

    // 如果是翻页请求，直接返回
    if (isPageNavigation) {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: `已跳转到第 ${currentPage} 页`,
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiResponse]);
      return;
    }

    setIsLoading(true);

    try {
      let requestBody: any = {
        model: modelName,
        messages: [
            {
              role: 'system',
              content: pdfDocument ? '你是一个PDF阅读助手，根据用户的问题和提供的PDF页面内容，给出详细的解答。请以Markdown格式返回你的回答。' : '你是一个智能助手，根据用户的问题给出详细的解答。请以Markdown格式返回你的回答。'
            }
          ],
        temperature: 0.7,
        max_tokens: 1000,
        stream: true
      };

      // 如果有PDF文档，添加页面图片作为上下文
      if (pdfDocument) {
        // 获取当前页面的图片
        let currentPageImage = pages[currentPage];
        if (!currentPageImage) {
          // 直接渲染页面并获取图片，不依赖状态更新
          const page = await pdfDocument.getPage(currentPage);
          // 使用默认缩放比例，保持PDF原样渲染
          const scale = 1.5;
          
          // 考虑高DPI屏幕（如视网膜屏）
          const devicePixelRatio = window.devicePixelRatio || 1;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (context) {
            // 调整canvas实际尺寸以适应高DPI屏幕
            canvas.height = viewport.height * devicePixelRatio;
            canvas.width = viewport.width * devicePixelRatio;
            canvas.style.height = `${viewport.height}px`;
            canvas.style.width = `${viewport.width}px`;

            // 缩放context以匹配设备像素比
            context.scale(devicePixelRatio, devicePixelRatio);

            const renderContext = {
              canvasContext: context,
              viewport: viewport
            };

            await page.render(renderContext).promise;
            currentPageImage = canvas.toDataURL('image/png', 1.0);
            setPages(prev => ({ ...prev, [currentPage]: currentPageImage }));
            canvas.remove();
          }
        }

        if (!currentPageImage) {
          throw new Error('无法获取页面图片');
        }

        // 调试日志：确认图片正在被传递
        console.log('正在发送PDF页面图片，图片大小:', currentPageImage.length, '字节');

        requestBody.messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: currentPageImage
              }
            },
            {
              type: 'text',
              text: inputMessage
            }
          ]
        });
      } else {
        // 没有PDF文档，只发送文本消息
        requestBody.messages.push({
          role: 'user',
          content: inputMessage
        });
      }

      // 调用oMLX本地大模型
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      const aiMessageId = (Date.now() + 1).toString();
      
      // 初始添加一个loading消息
      setMessages(prev => [...prev, {
        id: aiMessageId,
        content: '正在生成回答...',
        sender: 'ai',
        timestamp: new Date()
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') continue;
            
            try {
              const json = JSON.parse(data);
              const delta = json.choices[0].delta;
              if (delta.content) {
                fullContent += delta.content;
                // 更新消息内容
                setMessages(prev => prev.map(msg => 
                  msg.id === aiMessageId ? { ...msg, content: fullContent } : msg
                ));
              }
            } catch (error) {
              console.error('Error parsing stream chunk:', error);
            }
          }
        }
      }

      // 最终更新消息
      setMessages(prev => prev.map(msg => 
        msg.id === aiMessageId ? { ...msg, content: fullContent } : msg
      ));
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: '抱歉，我无法处理你的请求，请稍后再试。',
        sender: 'ai',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // 处理建议问题点击
  const handleSuggestedQuestionClick = (question: string) => {
    setInputMessage(question);
    handleSendMessage();
  };

  // 处理键盘回车
  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSendMessage();
    }
  };

  // 监听文本选择
  useEffect(() => {
    document.addEventListener('mouseup', handleTextSelection);
    return () => {
      document.removeEventListener('mouseup', handleTextSelection);
    };
  }, []);

  // 监听键盘事件，处理语音输入和页面切换
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 监听Option键（Mac）或Alt键（Windows）
      if (event.key === 'Alt') {
        if (!isRecording) {
          startRecording();
        }
      }
      // 监听Shift键，取消录音（丢弃录音）
      else if (event.key === 'Shift' && isRecording) {
        stopRecording(true);
      }
      // 监听左右箭头键，实现页面切换
      else if (event.key === 'ArrowLeft' && pdfDocument) {
        // 左箭头，上一页
        if (currentPage > 1) {
          handlePageChange(currentPage - 1);
        }
      }
      else if (event.key === 'ArrowRight' && pdfDocument) {
        // 右箭头，下一页
        if (currentPage < totalPages) {
          handlePageChange(currentPage + 1);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // 监听Option键（Mac）或Alt键（Windows）释放
      if (event.key === 'Alt') {
        if (isRecording) {
          stopRecording();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRecording, pdfDocument, currentPage, totalPages, handlePageChange]);

  // 开始录音
  const startRecording = async () => {
    console.log('开始录音');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('获取到媒体流');
      
      // 直接使用webm格式
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      console.log('创建MediaRecorder，使用MIME类型: audio/webm');
      
      // 重置ref
      audioChunksRef.current = [];
      
      recorder.ondataavailable = (event) => {
        console.log('数据可用，大小:', event.data.size, '类型:', event.data.type);
        if (event.data.size > 0) {
          console.log('添加音频数据');
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        console.log('录音停止');
        stream.getTracks().forEach(track => track.stop());
        console.log('媒体流已停止');
        console.log('ref中的音频块数量:', audioChunksRef.current.length);
        if (audioChunksRef.current.length > 0) {
          console.log('第一个音频块类型:', audioChunksRef.current[0].type);
        }
      };

      // 设置100ms的时间片，确保音频数据能够被正确收集
      recorder.start(100);
      console.log('开始录音，时间片设置为100ms');
      setMediaRecorder(recorder);
      setIsRecording(true);
      console.log('状态已更新');
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  // 停止录音并处理音频
  const stopRecording = async (discard: boolean = false) => {
    console.log('停止录音', discard ? '（丢弃录音）' : '');
    if (mediaRecorder) {
      console.log('mediaRecorder存在，调用stop()');
      mediaRecorder.stop();
      // 立即更新状态，不等待
      setIsRecording(false);
      setMediaRecorder(null);
      console.log('状态已更新');
      
      // 等待录音停止并处理音频
      setTimeout(async () => {
        console.log('处理音频，音频块数量:', audioChunksRef.current.length);
        if (audioChunksRef.current.length > 0 && !discard) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          console.log('音频blob大小:', audioBlob.size);
          await transcribeAudio();
        } else {
          console.log(discard ? '录音已丢弃' : '没有音频数据');
        }
        // 无论是否处理，都清空音频块
        audioChunksRef.current = [];
      }, 100);
    }else{
      console.log("录音未开始")
    }
  };

  // 调用Qwen3-ASR模型进行语音识别
  const transcribeAudio = async () => {
    setIsTranscribing(true);
    try {
      // 直接使用webm格式
      const webmBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', webmBlob, 'recording.webm');
      formData.append('model', asrModelName);

      // 从聊天API端点推导出语音识别API端点
      const apiUrl = apiEndpoint.replace('/chat/completions', '/audio/transcriptions');
      
      // 输出请求地址和参数到控制台
      console.log('语音识别请求地址:', apiUrl);
      console.log('语音识别请求参数:', {
        model: asrModelName,
        audio_size: webmBlob.size,
        audio_type: webmBlob.type,
        filename: 'recording.webm'
      });

      // 调用oMLX的语音识别API
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData
      });

      // 输出响应状态和文本
      console.log('响应状态:', response.status);
      console.log('响应状态文本:', response.statusText);
      
      // 尝试获取错误信息
      const responseText = await response.text();
      console.log('响应内容:', responseText);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, message: ${responseText}`);
      }

      const data = JSON.parse(responseText);
      const transcription = data.text;
      
      // 输出识别结果到控制台
      console.log('语音识别结果:', data);
      
      // 将识别结果设置为输入消息并发送
      if (transcription) {
        setInputMessage(transcription);
        // 延迟发送，确保状态更新
        setTimeout(() => {
          handleSendMessage();
        }, 100);
      }
    } catch (error) {
      console.error('Error transcribing audio:', error);
    } finally {
      setIsTranscribing(false);
    }
  };

  // 渲染页面
  useEffect(() => {
    if (pdfDocument && !pages[currentPage]) {
      renderPage(currentPage);
    }
  }, [pdfDocument, currentPage, pages]);

  // 从localStorage读取配置
  useEffect(() => {
    const savedApiEndpoint = localStorage.getItem('apiEndpoint');
    const savedApiKey = localStorage.getItem('apiKey');
    const savedModelName = localStorage.getItem('modelName');
    const savedAsrModelName = localStorage.getItem('asrModelName');

    if (savedApiEndpoint) setApiEndpoint(savedApiEndpoint);
    if (savedApiKey) setApiKey(savedApiKey);
    if (savedModelName) setModelName(savedModelName);
    if (savedAsrModelName) setAsrModelName(savedAsrModelName);
  }, []);

  // 保存配置到localStorage
  const saveSettings = () => {
    localStorage.setItem('apiEndpoint', apiEndpoint);
    localStorage.setItem('apiKey', apiKey);
    localStorage.setItem('modelName', modelName);
    localStorage.setItem('asrModelName', asrModelName);
    setIsSettingsOpen(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsResizing(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing) return;
    
    const container = document.querySelector('.container');
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    const newChatWidth = containerRect.width - e.clientX;
    
    // 限制最小宽度
    if (newChatWidth >= 300 && e.clientX >= 300) {
      setChatWidth(newChatWidth);
    }
  };

  const handleMouseUp = () => {
    setIsResizing(false);
  };

  // 监听鼠标移动和释放事件
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing]);

  return (
    <div className="container">
      {/* PDF Viewer */}
      <div className="pdf-viewer" ref={pdfContainerRef} tabIndex={0}>
        <div className="pdf-controls">
          <div className="file-upload">
            <input
              type="file"
              id="pdf-upload"
              accept=".pdf"
              onChange={handleFileUpload}
            />
            <label htmlFor="pdf-upload">选择PDF文件</label>
          </div>

          {pdfDocument && (
            <div className="page-controls">
              <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}>
                上一页
              </button>
              <input
                type="number"
                value={currentPage}
                onChange={(e) => handlePageChange(Number(e.target.value))}
                min="1"
                max={totalPages}
              />
              <span>/ {totalPages}</span>
              <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}>
                下一页
              </button>
            </div>
          )}
        </div>

        {pdfDocument && pages[currentPage] && (
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflow: 'auto' }}>
            <img
              src={pages[currentPage]}
              alt={`Page ${currentPage}`}
              className="pdf-page"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
        )}

        {selectedText && (
          <div className="suggested-questions">
            <h4>建议问题：</h4>
            {isGeneratingQuestions ? (
              <p>生成问题中...</p>
            ) : (
              suggestedQuestions.map(question => (
                <button
                  key={question.id}
                  onClick={() => handleSuggestedQuestionClick(question.question)}
                >
                  {question.question}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 调整大小的手柄 */}
      <div 
        className="resize-handle" 
        onMouseDown={handleMouseDown}
        style={{ cursor: isResizing ? 'col-resize' : 'col-resize' }}
      />

      {/* Chat Interface */}
      <div 
        className="chat-interface" 
        style={{ width: `${chatWidth}px` }}
      >
        <div className="chat-messages">
          {messages.map(message => (
            <div
              key={message.id}
              className={`message ${message.sender === 'user' ? 'user-message' : 'ai-message'}`}
              dangerouslySetInnerHTML={message.sender === 'ai' ? { __html: renderMarkdownWithKaTeX(message.content) } : undefined}
            >
              {message.sender === 'user' ? message.content : null}
            </div>
          ))}
        </div>
        <div className="chat-input">
          <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <button 
              onClick={() => setIsSettingsOpen(true)} 
              style={{ marginRight: '10px', padding: '5px 10px', cursor: 'pointer' }}
            >
              ⚙️
            </button>
            <span style={{ marginRight: '10px', color: isRecording ? '#ef4444' : isTranscribing ? '#f59e0b' : '#666' }}>
              {isRecording ? '🔴 录音中...' : isTranscribing ? '⏳ 正在识别...' : ''}
            </span>
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入你的问题... 或按住 Option 键开始语音输入"
              disabled={isLoading || isRecording || isTranscribing}
              style={{ flex: 1 }}
            />
          </div>
          <button onClick={handleSendMessage} disabled={isLoading || isRecording || isTranscribing}>
            {isLoading ? '发送中...' : '发送'}
          </button>
        </div>
      </div>

      {/* 设置弹窗 */}
      {isSettingsOpen && (
        <div className="settings-modal">
          <div className="settings-modal-content">
            <div className="settings-modal-header">
              <h3>设置</h3>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
            <div className="settings-modal-body">
              <div className="setting-item">
                <label>API 端点</label>
                <input
                  type="text"
                  value={apiEndpoint}
                  onChange={(e) => setApiEndpoint(e.target.value)}
                  placeholder="http://127.0.0.1:8000/v1/chat/completions"
                />
              </div>
              <div className="setting-item">
                <label>API 密钥</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入API密钥"
                />
              </div>
              <div className="setting-item">
                <label>模型名称</label>
                <input
                  type="text"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="gemma-4-26b-a4b-it-4bit"
                />
              </div>
              <div className="setting-item">
                <label>语音识别模型</label>
                <input
                  type="text"
                  value={asrModelName}
                  onChange={(e) => setAsrModelName(e.target.value)}
                  placeholder="Qwen3-ASR-1.7B-4bit"
                />
              </div>
            </div>
            <div className="settings-modal-footer">
              <button onClick={saveSettings} style={{ backgroundColor: '#3b82f6' }}>保存</button>
              <button onClick={() => setIsSettingsOpen(false)} style={{ backgroundColor: '#555' }}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;