package com.storybloom.app

import android.app.Application
import com.storybloom.app.audio.AudioEngine
import com.storybloom.app.data.StoryRepository
import com.storybloom.app.data.StorybloomDatabase
import com.storybloom.app.media.PageImageStore
import com.storybloom.app.speech.ModelManager
import com.storybloom.app.vision.PagePreparationEngine

class StorybloomApplication : Application() {
    lateinit var repository: StoryRepository
        private set
    lateinit var imageStore: PageImageStore
        private set
    lateinit var audioEngine: AudioEngine
        private set
    lateinit var preparationEngine: PagePreparationEngine
        private set
    lateinit var modelManager: ModelManager
        private set

    override fun onCreate() {
        super.onCreate()
        repository = StoryRepository(StorybloomDatabase.open(this))
        imageStore = PageImageStore(this)
        audioEngine = AudioEngine(this)
        modelManager = ModelManager(this)
        preparationEngine = PagePreparationEngine(this, repository)
    }

    override fun onTerminate() {
        audioEngine.release()
        super.onTerminate()
    }
}
